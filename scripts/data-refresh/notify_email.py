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


def build_email(manifest: dict, changed_ids: list[str], forced: bool) -> tuple[str, str, str, list[Path]]:
    """Return (subject, html, text, attachments)."""
    sources = manifest.get("sources", {})
    now_bj = datetime.now(TZ_SHANGHAI)
    weekday = "一二三四五六日"[now_bj.weekday()]
    date_label = f"{now_bj.strftime('%Y-%m-%d')}（周{weekday}）"

    failed_ids = [i for i, _ in WATCHED
                  if (sources.get(i) or {}).get("status") not in ("success", None)]
    if changed_ids:
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
        # Attach the workbook for changed sources, or all three on a forced baseline.
        if is_changed or (forced and not changed_ids):
            out = entry.get("outputFile")
            if out:
                p = REPO_ROOT / out
                if p.exists():
                    attachments.append(p)

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

    att_note = (f'附件：{len(attachments)} 个 Excel（About + Data 双表）'
                if attachments else '无附件（本次没有名单发生变化）')
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
    </div>
    {''.join(blocks)}
    <div style="border-top:1px solid #EEE;margin-top:22px;padding-top:12px;font-size:11px;color:#999;text-align:center">
      变更判定基于数据行内容哈希，不看文件字节 —— 工作簿每天都会重写「Fetched at」时间戳，字节必变。<br>
      内容无变化时不发送本邮件。仓库：strangeromo-cloud/aml · GitHub Actions 每日 08:00（北京）
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
    failed_ids = [i for i in watched_ids if (sources.get(i) or {}).get("status") not in ("success", None)]

    print(f"watched={watched_ids}")
    print(f"changed={changed_ids}  failed={failed_ids}  force={args.force}")

    # A failed watched fetcher is worth an email even without a content change —
    # silence would otherwise be indistinguishable from "no update".
    should_send = bool(changed_ids) or bool(failed_ids) or args.force
    if not should_send:
        print("No change in any watched list — not sending.")
        return 0

    subject, html, text, attachments = build_email(manifest, changed_ids, args.force)
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
