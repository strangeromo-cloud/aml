"""Email the watched public lists — but only when their contents actually changed.

Follows the Gmail-SMTP pattern from the cct project's server/email_sender.py:
stdlib smtplib + email.mime, credentials from env, no extra dependencies.

Change detection deliberately does NOT look at the .xlsx bytes: every workbook
stamps "Fetched at (UTC)" on its About sheet, so the files differ on every run.
`refresh_all` hashes the DATA rows and records `changed` per source in the
manifest; this script only sends when one of the watched sources flipped.

Usage:
  python -m scripts.data-refresh.notify_email                # send only if changed
  python -m scripts.data-refresh.notify_email --force        # send regardless (baseline)
  python -m scripts.data-refresh.notify_email --dry-run      # compose + print, never send

Env:
  SMTP_USER            Gmail address used as the sender
  SMTP_PASSWORD        Gmail App Password (16 chars, not the account password)
  LIST_ALERT_RECIPIENT Comma-separated recipients
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import sys
from datetime import datetime, timedelta, timezone
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate
import re
from html import escape
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "public" / "downloads"
MANIFEST_FILE = OUTPUT_DIR / "_manifest.json"
SNAPSHOT_DIR = OUTPUT_DIR / "_snapshots"

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
TZ_SHANGHAI = timezone(timedelta(hours=8))

# The three lists Legal asked to be notified about. Order drives the email layout.
WATCHED = [
    ("ti-cpi", "CPI · Transparency International 清廉指数"),
    ("fatf-jurisdictions", "FATF 黑 / 灰名单"),
    ("eu-offshore-centres", "离岸金融中心名单（EU / Eurostat）"),
]

# The FATF sheet in the attachment comes from the Legal-maintained baseline, not from
# the fetchers, so a baseline edit changes what Legal receives while every fetched
# source stays byte-identical. Watched separately, otherwise Legal updates the
# workbook and gets no email confirming it took effect.
BASELINE_ID = "fatf-baseline"
BASELINE_LABEL = "FATF 基线（法务人工维护）"


# Legal's confirmed CPI / offshore lists take precedence in the attachment, so the
# fetched data can drift away unseen. Report the gap on every email: "以法务为准" must
# not become "从此不再更新".
# (file, source id, label, key inside the override, name field in the snapshot,
#  value field in the snapshot — None when the list carries names only)
OVERRIDES = [
    ("cpi-override.json", "ti-cpi", "CPI", "scores", "country", "score"),
    ("offshore-override.json", "eu-offshore-centres", "离岸中心", "jurisdictions",
     "jurisdiction", None),
]


def override_drift(legal_report: dict | None = None) -> list[str]:
    lines: list[str] = []
    seeds = Path(__file__).resolve().parent / "seeds"
    try:
        from .verify_fatf import norm
    except Exception:
        return lines
    for fname, source_id, label, key, field, value_field in OVERRIDES:
        p = seeds / fname
        if not p.exists():
            continue
        try:
            ov = json.loads(p.read_text())
        except json.JSONDecodeError:
            lines.append(f"{label}：法务确认版本文件无法解析，已回退到抓取数据")
            continue
        confirmed = ov.get(key) or {}
        names_ov = {norm(k) for k in (confirmed.keys() if isinstance(confirmed, dict) else confirmed)}
        snap = SNAPSHOT_DIR / f"{source_id}.json"
        if not snap.exists():
            continue
        try:
            fetched = json.loads(snap.read_text())
        except json.JSONDecodeError:
            continue
        names_f = {norm(str(r.get(field) or "")) for r in fetched} - {""}
        extra, missing = sorted(names_f - names_ov), sorted(names_ov - names_f)
        # Same jurisdictions is not the same list: CPI is a score per country, and a
        # name-only comparison called a 90-vs-89 Denmark "identical". Compare the
        # values too wherever the source carries one.
        value_diffs: list[str] = []
        if value_field and isinstance(confirmed, dict):
            def _num(v):
                try:
                    return int(round(float(v)))
                except (TypeError, ValueError):
                    return None
            vals_f = {norm(str(r.get(field) or "")): _num(r.get(value_field))
                      for r in fetched}
            for k, v in confirmed.items():
                nk, nv = norm(k), _num(v)
                if nk in vals_f and nv is not None and vals_f[nk] is not None \
                        and vals_f[nk] != nv:
                    value_diffs.append(f"{nk} 法务版 {nv} / 抓取 {vals_f[nk]}")
            value_diffs.sort()
        who = f"{ov.get('confirmedBy', '?')} · {ov.get('confirmedAt', '?')}"
        # Which side actually won is decided in build_legal_workbook by recency; read
        # it rather than restating a rule that could drift out of step.
        key = "cpi" if source_id == "ti-cpi" else "offshore"
        effective = ((legal_report or {}).get(key) or {}).get("source") or "未知"
        legal_won = "法务确认" in effective
        who_note = f"法务确认版本（{who}）" if legal_won else f"本次抓取（法务确认版本 {who} 已被更新的抓取数据取代）"
        if not extra and not missing and not value_diffs:
            lines.append(f"{label}：本次生效 = {who_note}，两者内容一致")
        else:
            bits = []
            if extra:
                bits.append(f"抓取多出 {len(extra)} 项：{', '.join(extra[:12])}")
            if missing:
                bits.append(f"法务版多出 {len(missing)} 项：{', '.join(missing[:12])}")
            if value_diffs:
                bits.append(f"{len(value_diffs)} 项取值不同：{'；'.join(value_diffs[:8])}")
            tail = ("请复核是否需要更新法务版本。" if legal_won
                    else "抓取数据更新，已自动生效，法务版本仅供比对。")
            lines.append(f"⚠ {label}：本次生效 = {who_note}，两者不一致 —— "
                         + "；".join(bits) + "。" + tail)
    return lines


def baseline_state() -> dict | None:
    """Effective baseline as {listDate, rows}, or None when it cannot be read."""
    try:
        from .verify_fatf import load_baseline
        seed = load_baseline()
    except Exception as e:
        print(f"::warning::读取基线失败（{type(e).__name__}: {e}），本次不做基线变更判定")
        return None
    if not seed:
        return None
    rows = sorted(
        f"{'black' if 'call for action' in str(r.get('status', '')).lower() else 'grey'}|"
        f"{str(r.get('country', '')).strip()}"
        for r in seed.get("rows") or []
    )
    return {"listDate": seed.get("listDate"), "rows": rows,
            "provenance": seed.get("provenance")}


def baseline_changed() -> tuple[bool, dict | None, dict | None]:
    """(changed, current, previous) against the copy committed in git."""
    cur = baseline_state()
    if cur is None:
        return False, None, None
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    (SNAPSHOT_DIR / f"{BASELINE_ID}.json").write_text(
        json.dumps(cur, ensure_ascii=False, indent=1, sort_keys=True))
    prev = _load_git_previous_snapshot(BASELINE_ID)
    if prev is None:
        return False, cur, None            # first run establishes the baseline record
    return (prev.get("listDate") != cur.get("listDate")
            or prev.get("rows") != cur.get("rows")), cur, prev

# Which column identifies a row, per source — used to render an added/removed diff.
KEY_FIELD = {
    "ti-cpi": "country",
    "fatf-jurisdictions": "jurisdiction",
    "eu-offshore-centres": "jurisdiction",
}

XLSX_MIME = "vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _parse_recipients(raw: str) -> list[str]:
    if not raw:
        return []
    parts = raw.replace(";", ",").replace("\n", ",").split(",")
    return [p.strip() for p in parts if p.strip()]


def _row_key(source_id: str, row: dict) -> str:
    """Best-effort stable label for a row, for the added/removed diff."""
    field = KEY_FIELD.get(source_id)
    if field and row.get(field):
        return str(row[field])
    for candidate in ("country", "jurisdiction", "name", "entity"):
        if row.get(candidate):
            return str(row[candidate])
    return json.dumps(row, sort_keys=True, ensure_ascii=False)[:80]


def _load_git_previous_snapshot(source_id: str) -> list[dict] | None:
    """Read the committed (pre-run) snapshot from git, for the row-level diff."""
    import subprocess
    rel = f"public/downloads/_snapshots/{source_id}.json"
    try:
        out = subprocess.run(
            ["git", "show", f"HEAD:{rel}"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            return None
        return json.loads(out.stdout)
    except Exception:
        return None


def diff_source(source_id: str) -> dict:
    """Compare the freshly written snapshot against the one committed in git."""
    cur_path = SNAPSHOT_DIR / f"{source_id}.json"
    if not cur_path.exists():
        return {"added": [], "removed": [], "modified": [], "available": False}
    try:
        cur = json.loads(cur_path.read_text())
    except json.JSONDecodeError:
        return {"added": [], "removed": [], "modified": [], "available": False}
    prev = _load_git_previous_snapshot(source_id)
    if prev is None:
        return {"added": [], "removed": [], "modified": [], "available": False}

    cur_map = {_row_key(source_id, r): r for r in cur}
    prev_map = {_row_key(source_id, r): r for r in prev}
    added = sorted(set(cur_map) - set(prev_map))
    removed = sorted(set(prev_map) - set(cur_map))
    modified = sorted(
        k for k in set(cur_map) & set(prev_map)
        if json.dumps(cur_map[k], sort_keys=True, ensure_ascii=False)
        != json.dumps(prev_map[k], sort_keys=True, ensure_ascii=False)
    )
    return {"added": added, "removed": removed, "modified": modified, "available": True}


def _chips(items: list[str], color: str, limit: int = 40) -> str:
    if not items:
        return '<span style="color:#999;font-size:12px">—</span>'
    shown = items[:limit]
    more = len(items) - len(shown)
    html = " ".join(
        f'<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 7px;'
        f'border-radius:3px;background:{color}18;color:{color};font-size:12px">{escape(s)}</span>'
        for s in shown
    )
    if more:
        html += f'<span style="color:#888;font-size:12px">…另 {more} 项</span>'
    return html


def build_email(manifest: dict, changed_ids: list[str], forced: bool,
                baseline: tuple[bool, dict | None, dict | None] = (False, None, None),
                ) -> tuple[str, str, str, list[Path]]:
    """Return (subject, html, text, attachments)."""
    sources = manifest.get("sources", {})
    now_bj = datetime.now(TZ_SHANGHAI)
    weekday = "一二三四五六日"[now_bj.weekday()]
    date_label = f"{now_bj.strftime('%Y-%m-%d')}（周{weekday}）"

    base_changed, base_cur, base_prev = baseline
    failed_ids = [i for i, _ in WATCHED
                  if (sources.get(i) or {}).get("status") not in ("success", None)]
    if base_changed:
        subject = (f"[AML 公开名单] {date_label} · FATF 基线已更新至 "
                   f"{(base_cur or {}).get('listDate')}")
        headline = (f"法务维护的 FATF 基线已更新："
                    f"{(base_prev or {}).get('listDate')} → {(base_cur or {}).get('listDate')}。"
                    f"本邮件附件已使用新基线。")
    elif changed_ids:
        names = [n for i, n in WATCHED if i in changed_ids]
        suffix = f" · {len(failed_ids)} 个抓取失败" if failed_ids else ""
        subject = f"[AML 公开名单] {date_label} · {len(changed_ids)} 个名单有更新{suffix}"
        headline = "以下公开名单相比上次抓取发生了变化：" + "、".join(names)
    elif forced:
        subject = f"[AML 公开名单] {date_label} · 基线快照"
        headline = "基线快照（本次为手动触发，非变更通知）"
    else:
        # Only reached when a watched fetcher failed — no content change to report.
        names = [n for i, n in WATCHED if i in failed_ids]
        subject = f"[AML 公开名单] {date_label} · 抓取失败告警（{len(failed_ids)}）"
        headline = ("本次没有名单内容变化，但以下名单抓取失败，"
                    "因此无法确认其是否更新：" + "、".join(names))

    blocks: list[str] = []
    text_lines: list[str] = [f"AML 公开名单更新通知 · {date_label}", "", headline, ""]
    attachments: list[Path] = []

    for sid, label in WATCHED:
        entry = sources.get(sid) or {}
        status = entry.get("status", "missing")
        records = entry.get("records")
        prev_records = entry.get("previousRecords")
        is_changed = sid in changed_ids

        if status != "success":
            badge = ('<span style="padding:2px 8px;border-radius:3px;background:#FDEEEE;'
                     'color:#C0392B;font-size:12px;font-weight:600">抓取失败</span>')
            detail = f'<div style="font-size:12px;color:#C0392B;margin-top:6px">{escape(str(entry.get("error", "unknown")))}</div>'
            text_lines.append(f"[抓取失败] {label} — {entry.get('error')}")
        elif is_changed:
            badge = ('<span style="padding:2px 8px;border-radius:3px;background:#FFF4E5;'
                     'color:#B26A00;font-size:12px;font-weight:600">有更新</span>')
            d = diff_source(sid)
            rows_html = [
                f'<div style="font-size:12px;color:#555;margin-top:6px">'
                f'记录数 {prev_records if prev_records is not None else "—"} → <strong>{records}</strong></div>'
            ]
            if d["available"]:
                rows_html.append(f'<div style="margin-top:8px;font-size:12px;color:#555">新增：{_chips(d["added"], "#1D7A46")}</div>')
                rows_html.append(f'<div style="margin-top:4px;font-size:12px;color:#555">移除：{_chips(d["removed"], "#B3261E")}</div>')
                rows_html.append(f'<div style="margin-top:4px;font-size:12px;color:#555">字段变化：{_chips(d["modified"], "#B26A00")}</div>')
                text_lines.append(
                    f"[有更新] {label} — 记录数 {prev_records} → {records}；"
                    f"新增 {len(d['added'])}、移除 {len(d['removed'])}、字段变化 {len(d['modified'])}"
                )
                if d["added"]:
                    text_lines.append("  新增: " + ", ".join(d["added"][:40]))
                if d["removed"]:
                    text_lines.append("  移除: " + ", ".join(d["removed"][:40]))
                if d["modified"]:
                    text_lines.append("  字段变化: " + ", ".join(d["modified"][:40]))
            else:
                rows_html.append('<div style="margin-top:6px;font-size:12px;color:#888">'
                                 '（无可比对的历史快照，仅报告内容哈希变化）</div>')
                text_lines.append(f"[有更新] {label} — 内容哈希变化，记录数 {prev_records} → {records}")
            detail = "".join(rows_html)
        else:
            badge = ('<span style="padding:2px 8px;border-radius:3px;background:#EEF4F0;'
                     'color:#5A7D6A;font-size:12px;font-weight:600">无变化</span>')
            detail = f'<div style="font-size:12px;color:#888;margin-top:6px">记录数 {records}</div>'
            text_lines.append(f"[无变化] {label} — 记录数 {records}")

        blocks.append(f"""
<div style="margin:0 0 12px;padding:14px 16px;border:1px solid #E5E5E5;border-radius:8px;background:#fff">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <strong style="font-size:14px;color:#111">{escape(label)}</strong> {badge}
  </div>
  <div style="font-size:11px;color:#999;margin-top:4px">
    <a href="{escape(str(entry.get('url') or ''), quote=True)}" style="color:#0563C1;text-decoration:none">{escape(str(entry.get('url') or ''))}</a>
  </div>
  {detail}
</div>""")

    # One attachment only: the Legal-facing workbook in the exact shape of
    # docs/公开名单-CPI-离岸-FATF.xlsx (three sheets, always all three).
    from .build_legal_workbook import build as build_legal, default_out_path
    legal_path = default_out_path()
    legal_report = build_legal(legal_path)
    attachments.append(legal_path)
    _fatf = legal_report.get("fatf", {})
    # Only warn when the baseline and the fetch actually disagree (or the fetch is
    # unusable). "Baseline used, and it matches today's official fetch" is the
    # healthy steady state — flagging it as a warning trains people to ignore ⚠.
    seeded = bool(_fatf.get("seeded")) and not _fatf.get("agreesWithFetch")
    att_note = (f'附件：{legal_path.name}（CPI / 离岸 / FATF 三个 sheet，'
                f'格式与法务参考文件一致）'
                + ('　⚠ FATF 为基线名单，非本次抓取' if seeded else ''))
    # A receipt Legal can check at a glance: which baseline version this attachment
    # was built from, and whether it changed since the last email.
    bl = base_cur or {}
    if base_changed:
        base_line = (f'FATF 基线：<strong>{escape(str(bl.get("listDate")))}</strong>'
                     f'（{len(bl.get("rows") or [])} 条）· 已更新，上一版为 '
                     f'{escape(str((base_prev or {}).get("listDate")))}')
    elif bl:
        base_line = (f'FATF 基线：{escape(str(bl.get("listDate")))}'
                     f'（{len(bl.get("rows") or [])} 条）· 本次无变化')
    else:
        base_line = 'FATF 基线：读取失败'
    # Say which of the two the sheet actually used. They normally agree — that is what
    # the verification is for — but when they do not, an unexplained sheet is worse
    # than a blunt one.
    fr = legal_report.get("fatf", {})
    if fr.get("seeded"):
        base_line += (f'　|　附件 FATF 页使用：<strong>法务基线</strong>'
                      f'（{escape(str(fr.get("reason") or "本次抓取不可用"))}）')
    elif fr.get("records"):
        base_line += (f'　|　附件 FATF 页使用：<strong>本次官方抓取</strong>'
                      f'（名单日期 {escape(str(fr.get("listDate") or "未知"))}）')
    text_lines.insert(3, f"[基线] {re.sub(r'<[^>]+>', '', base_line)}")
    drift = override_drift(legal_report)
    for i, d in enumerate(drift):
        text_lines.insert(4 + i, f"[覆盖] {d}")
    drift_html = "".join(
        f'<div style="font-size:12px;color:{"#B26A00" if d.startswith("⚠") else "#555"};'
        f'margin-top:4px">{escape(d)}</div>' for d in drift)
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AML 公开名单更新</title></head>
<body style="margin:0;padding:20px;background:#F7F7F7;font-family:'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#222">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:10px;padding:22px 24px 30px;box-shadow:0 1px 4px rgba(0,0,0,0.05)">
    <div style="border-bottom:1px solid #EEE;padding-bottom:14px;margin-bottom:16px">
      <div style="font-size:20px;font-weight:700;color:#111">AML 公开名单更新
        <span style="font-size:14px;font-weight:500;color:#666;margin-left:8px">{date_label}</span>
      </div>
      <div style="font-size:12px;color:#888;margin-top:6px">{escape(headline)}</div>
      <div style="font-size:12px;color:#888;margin-top:4px">抓取时间（UTC）：{escape(str(manifest.get('updatedAt') or ''))} · {escape(att_note)}</div>
      <div style="font-size:12px;color:#555;margin-top:6px;padding:8px 10px;background:#FAFAFA;border:1px solid #EEE;border-radius:6px">{base_line}{drift_html}</div>
    </div>
    {''.join(blocks)}
    <div style="border-top:1px solid #EEE;margin-top:22px;padding-top:12px;font-size:11px;color:#999;text-align:center">
      变更判定基于数据行内容哈希，不看文件字节 —— 工作簿每天都会重写「Fetched at」时间戳，字节必变。<br>
      内容无变化时不发送本邮件。仓库：strangeromo-cloud/aml · GitHub Actions 每日 07:00（北京）
    </div>
  </div>
</body></html>"""

    text_lines += ["", "变更判定基于数据行内容哈希，不看文件字节。内容无变化时不发送本邮件。"]
    return subject, html, "\n".join(text_lines), attachments


def send(subject: str, html: str, text: str, attachments: list[Path],
         smtp_user: str, smtp_password: str, recipients: list[str]) -> dict:
    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = formataddr(("AML List Watch", smtp_user))
    msg["To"] = ", ".join(recipients)
    msg["Date"] = formatdate(localtime=True)

    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text, "plain", "utf-8"))
    alt.attach(MIMEText(html, "html", "utf-8"))
    msg.attach(alt)

    for p in attachments:
        part = MIMEApplication(p.read_bytes(), _subtype=XLSX_MIME)
        part.add_header("Content-Disposition", "attachment", filename=p.name)
        msg.attach(part)

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=45) as server:
            server.ehlo(); server.starttls(); server.ehlo()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, recipients, msg.as_string())
        return {"sent": True, "recipients": recipients, "error": None}
    except Exception as e:
        return {"sent": False, "recipients": recipients, "error": f"{type(e).__name__}: {e}"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="Send even when nothing changed (use for the first baseline email)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Compose and report, but never connect to SMTP")
    args = ap.parse_args()

    if not MANIFEST_FILE.exists():
        print("::error::manifest not found — run refresh_all first")
        return 1
    manifest = json.loads(MANIFEST_FILE.read_text())
    sources = manifest.get("sources", {})

    watched_ids = [i for i, _ in WATCHED]
    missing = [i for i in watched_ids if i not in sources]
    if missing:
        print(f"::warning::watched sources absent from manifest: {', '.join(missing)}")

    changed_ids = [i for i in watched_ids if (sources.get(i) or {}).get("changed")]
    base_changed, base_cur, base_prev = baseline_changed()
    failed_ids = [i for i in watched_ids if (sources.get(i) or {}).get("status") not in ("success", None)]

    print(f"watched={watched_ids} + {BASELINE_ID}")
    print(f"changed={changed_ids}  failed={failed_ids}  "
          f"baseline_changed={base_changed}  force={args.force}")
    if base_cur:
        print(f"baseline in this run: {base_cur.get('listDate')} "
              f"({len(base_cur.get('rows') or [])} 条) · {base_cur.get('provenance')}")

    # A failed watched fetcher is worth an email even without a content change —
    # silence would otherwise be indistinguishable from "no update".
    should_send = bool(changed_ids) or bool(failed_ids) or base_changed or args.force
    if not should_send:
        print("No change in any watched list — not sending.")
        return 0

    subject, html, text, attachments = build_email(
        manifest, changed_ids, args.force,
        baseline=(base_changed, base_cur, base_prev))
    print(f"subject: {subject}")
    print(f"attachments: {[p.name for p in attachments]}")

    if args.dry_run:
        out = Path("/tmp/aml-list-alert-preview.html")
        out.write_text(html, encoding="utf-8")
        print(f"--dry-run: preview written to {out}")
        print("---- text part ----")
        print(text)
        return 0

    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    recipients = _parse_recipients(os.getenv("LIST_ALERT_RECIPIENT", ""))
    if not smtp_user or not smtp_password:
        print("::error::SMTP_USER / SMTP_PASSWORD not set — cannot send")
        return 1
    if not recipients:
        print("::error::LIST_ALERT_RECIPIENT not set — cannot send")
        return 1

    res = send(subject, html, text, attachments, smtp_user, smtp_password, recipients)
    if res["sent"]:
        print(f"Sent to {', '.join(res['recipients'])}")
        return 0
    print(f"::error::send failed — {res['error']}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
