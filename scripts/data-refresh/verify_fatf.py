"""Cross-check the FATF black/grey lists against the Legal-approved baseline.

Why this exists: the FATF page sits behind Cloudflare, so the primary fetch is
unreliable (direct GET → 403, Playwright → no publication links, Wayback → 5xx).
Rather than let a failed or partial fetch silently become "the list", every
source we can reach is compared against the baseline Legal signed off on:

  identical  → pass, nothing to report
  different  → alert on Lark + email, and DO NOT touch the baseline; a human
               confirms against fatf-gafi.org and updates the baseline by hand
  no source  → also alert; "cannot verify" must never look like "no change"

The baseline is authoritative on purpose. Nothing here writes it — matching the
project rule that automation may propose a change to an authoritative list but
never apply one.

Usage:
  python -m scripts.data-refresh.verify_fatf                 # verify + alert on mismatch
  python -m scripts.data-refresh.verify_fatf --dry-run       # report only, never send

Env:
  LARK_WEBHOOK          Lark (Feishu) incoming-webhook URL
  SMTP_USER / SMTP_PASSWORD
  FATF_REVIEW_RECIPIENT Who reviews a mismatch (default xujz4@lenovo.com)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "public" / "downloads"
SNAPSHOT_DIR = OUTPUT_DIR / "_snapshots"
SEED_DIR = Path(__file__).resolve().parent / "seeds"
BASELINE_FILE = SEED_DIR / "fatf-baseline.json"

TZ_SHANGHAI = timezone(timedelta(hours=8))
DEFAULT_REVIEWER = "xujz4@lenovo.com"

FATF_PAGE = ("https://www.fatf-gafi.org/en/publications/"
             "High-risk-and-other-monitored-jurisdictions.html")

# Jurisdiction names differ cosmetically between sources; normalise before diffing
# so "Korea, Democratic People's Republic of" and "Democratic People's Republic of
# Korea" do not read as a change.
ALIASES = {
    "democratic peoples republic of korea": "north korea",
    "korea democratic peoples republic of": "north korea",
    "dprk": "north korea",
    "burma": "myanmar",
    "virgin islands uk": "british virgin islands",
    "virgin islands british": "british virgin islands",
    "democratic republic of congo": "democratic republic of the congo",
    "drc": "democratic republic of the congo",
    "lao peoples democratic republic": "laos",
    "syrian arab republic": "syria",
    "united republic of tanzania": "tanzania",
    "viet nam": "vietnam",
}


def norm(name: str) -> str:
    """Fold accents before stripping, so Côte d'Ivoire survives as "cote divoire"
    rather than losing the ô entirely and differing between sources."""
    import unicodedata
    decomposed = unicodedata.normalize("NFKD", name or "")
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    s = re.sub(r"[^a-z\s]", "", ascii_only.lower()).strip()
    s = re.sub(r"\s+", " ", s)
    return ALIASES.get(s, s)


def classify(status: str) -> str:
    s = (status or "").lower()
    return "black" if ("call for action" in s or "black" in s) else "grey"


def as_sets(rows: list[dict]) -> dict[str, set[str]]:
    out = {"black": set(), "grey": set()}
    for r in rows or []:
        out[classify(str(r.get("status") or ""))].add(norm(str(r.get("country") or "")))
    out["black"].discard("")
    out["grey"].discard("")
    return out


# ── Sources ─────────────────────────────────────────────────────────────

def source_fresh_fetch() -> tuple[str, list[dict] | None, str | None]:
    """Whatever the daily fetcher managed to write this run."""
    p = SNAPSHOT_DIR / "fatf-jurisdictions.json"
    if not p.exists():
        return "官方页面（本次抓取）", None, "本次抓取未产出快照"
    try:
        return "官方页面（本次抓取）", json.loads(p.read_text()), None
    except json.JSONDecodeError as e:
        return "官方页面（本次抓取）", None, f"快照解析失败: {e}"


def source_wayback() -> tuple[str, list[dict] | None, str | None]:
    """Most recent Wayback capture of the official page.

    Authoritative content, just time-shifted — the best independent check we have
    while the live page is behind Cloudflare.
    """
    label = "Wayback 存档（官方页面）"
    api = ("http://archive.org/wayback/available?url="
           + urllib.request.quote(FATF_PAGE, safe=""))
    try:
        with urllib.request.urlopen(
            urllib.request.Request(api, headers={"User-Agent": "aml-data-refresh"}),
            timeout=30,
        ) as r:
            meta = json.loads(r.read())
    except Exception as e:
        return label, None, f"Wayback 查询失败: {type(e).__name__}: {e}"

    snap = ((meta.get("archived_snapshots") or {}).get("closest") or {})
    url = snap.get("url")
    if not url:
        return label, None, "Wayback 无可用存档"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": "aml-data-refresh"}),
            timeout=45,
        ) as r:
            html = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        return label, None, f"Wayback 取页失败: {type(e).__name__}: {e}"

    rows = _parse_fatf_html(html)
    if not rows:
        return label, None, "Wayback 页面结构无法解析"
    return f"{label} @ {snap.get('timestamp', '')[:8]}", rows, None


def _parse_fatf_html(html: str) -> list[dict]:
    """Pull jurisdiction names out of the two FATF sections of the official page."""
    import html as html_mod
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    rows: list[dict] = []
    # The page lists the two groups under headings; take the anchor text inside
    # each section, which is the jurisdiction name.
    for status, pattern in (
        ("Call for Action", r"Call for Action(.*?)(?:Increased Monitoring|</main>)"),
        ("Increased Monitoring", r"Increased Monitoring(.*?)(?:</main>|Documents)"),
    ):
        m = re.search(pattern, text, re.S | re.I)
        if not m:
            continue
        chunk = m.group(1)
        for a in re.findall(r"<a[^>]*>(.*?)</a>", chunk, re.S):
            name = html_mod.unescape(re.sub(r"<[^>]+>", "", a)).strip()
            if 3 <= len(name) <= 60 and re.match(r"^[A-Z][A-Za-z' \-\(\),\.]+$", name):
                rows.append({"status": status, "country": name})
    # De-duplicate while keeping the first classification seen.
    seen, out = set(), []
    for r in rows:
        k = (r["status"], norm(r["country"]))
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKI_PAGE = "Financial Action Task Force blacklist"


def _wiki_section(wikitext: str, heading: str) -> str | None:
    m = re.search(r"^==+\s*" + re.escape(heading) + r"\s*==+\s*$(.*?)(?=^==+\s|\Z)",
                  wikitext, re.M | re.S)
    return m.group(1) if m else None


def _wiki_flags(section: str) -> tuple[list[str], str | None]:
    """Names from the first numbered {{flag|…}} block, plus the stated "as of" date."""
    as_of = None
    m = re.search(r"As of\s+(\d{1,2}\s+\w+\s+\d{4})", section)
    if m:
        as_of = m.group(1)
    # Only the leading div-col block holds the current list; prose and history
    # tables below it mention many other countries.
    block = section
    b = re.search(r"\{\{div col.*?\}\}(.*?)\{\{col div end\}\}", section, re.S | re.I)
    if b:
        block = b.group(1)
    names = []
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith("#"):
            continue
        f = re.search(r"\{\{\s*flag(?:country|icon)?\s*\|\s*([^}|]+)", line, re.I)
        if f:
            names.append(f.group(1).strip())
            continue
        # Fall back to a plain wiki link if the flag template is absent.
        f = re.search(r"\[\[([^\]\|]+)", line)
        if f:
            names.append(f.group(1).strip())
    return names, as_of


def source_wikipedia() -> tuple[str, list[dict] | None, str | None]:
    """English Wikipedia's maintained "Current FATF blacklist / grey list" sections.

    Chosen as the machine-readable cross-check because Wikidata carries no
    membership statements for these lists (Q607466 is a topic item only) and
    OpenSanctions does not publish jurisdiction lists at all. This is community-
    maintained data, so it is a tripwire against the Legal baseline — never a
    replacement for it.
    """
    label = "Wikipedia（Current FATF lists）"
    url = (f"{WIKI_API}?action=parse&format=json&prop=wikitext&redirects=1&page="
           + urllib.request.quote(WIKI_PAGE))
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": "aml-data-refresh/1.0"}),
            timeout=40,
        ) as r:
            wt = json.loads(r.read())["parse"]["wikitext"]["*"]
    except Exception as e:
        return label, None, f"Wikipedia 取页失败: {type(e).__name__}: {e}"

    rows: list[dict] = []
    dates: list[str] = []
    for heading, status in (("Current FATF blacklist", "Call for Action"),
                            ("Current FATF grey list", "Increased Monitoring")):
        sec = _wiki_section(wt, heading)
        if not sec:
            return label, None, f"章节缺失: {heading}（条目结构可能已改）"
        names, as_of = _wiki_flags(sec)
        if not names:
            return label, None, f"章节 {heading} 未解析出辖区（结构可能已改）"
        if as_of:
            dates.append(as_of)
        rows += [{"status": status, "country": n} for n in names]

    suffix = f" @ as of {dates[0]}" if dates else ""
    return f"{label}{suffix}", rows, None


SOURCES = [source_fresh_fetch, source_wikipedia, source_wayback]


# ── Comparison ──────────────────────────────────────────────────────────

def compare(baseline: dict[str, set[str]], candidate: dict[str, set[str]]) -> dict:
    res = {}
    for key in ("black", "grey"):
        res[key] = {
            "added": sorted(candidate[key] - baseline[key]),
            "removed": sorted(baseline[key] - candidate[key]),
        }
    res["identical"] = not any(res[k]["added"] or res[k]["removed"] for k in ("black", "grey"))
    return res


def verify() -> dict:
    if not BASELINE_FILE.exists():
        return {"ok": False, "reason": "baseline_missing",
                "detail": f"基线文件不存在: {BASELINE_FILE}"}
    seed = json.loads(BASELINE_FILE.read_text())
    baseline = as_sets(seed.get("rows") or [])
    report = {
        "baselineDate": seed.get("listDate"),
        "baselineProvenance": seed.get("provenance"),
        "baselineCounts": {k: len(v) for k, v in baseline.items()},
        "sources": [],
    }
    for fn in SOURCES:
        label, rows, err = fn()
        if rows is None:
            report["sources"].append({"label": label, "reachable": False, "error": err})
            continue
        cand = as_sets(rows)
        diff = compare(baseline, cand)
        report["sources"].append({
            "label": label, "reachable": True,
            "counts": {k: len(v) for k, v in cand.items()},
            "identical": diff["identical"], "diff": diff,
        })

    reachable = [s for s in report["sources"] if s["reachable"]]
    if not reachable:
        report["ok"] = False
        report["reason"] = "no_source"
    elif all(s["identical"] for s in reachable):
        report["ok"] = True
        report["reason"] = "identical"
    else:
        report["ok"] = False
        report["reason"] = "mismatch"
    return report


# ── Alerting ────────────────────────────────────────────────────────────

def _diff_lines(report: dict) -> list[str]:
    lines: list[str] = []
    for s in report.get("sources", []):
        if not s["reachable"]:
            lines.append(f"· {s['label']}：取不到 —— {s.get('error')}")
            continue
        if s["identical"]:
            lines.append(f"· {s['label']}：与基线一致（黑 {s['counts']['black']} / 灰 {s['counts']['grey']}）")
            continue
        lines.append(f"· {s['label']}：**与基线不一致**（黑 {s['counts']['black']} / 灰 {s['counts']['grey']}）")
        for key, cn in (("black", "黑名单"), ("grey", "灰名单")):
            d = s["diff"][key]
            if d["added"]:
                lines.append(f"    {cn} 新增：{', '.join(d['added'])}")
            if d["removed"]:
                lines.append(f"    {cn} 移除：{', '.join(d['removed'])}")
    return lines


def send_lark(webhook: str, report: dict) -> dict:
    """Post an interactive card to a Lark incoming webhook (cct lark_client pattern)."""
    if not webhook:
        return {"sent": False, "error": "LARK_WEBHOOK not configured"}
    now = datetime.now(TZ_SHANGHAI).strftime("%Y-%m-%d %H:%M")
    reason = report.get("reason")
    if reason == "mismatch":
        title, colour = "⚠ FATF 名单与基线不一致，需人工核查", "orange"
    elif reason == "no_source":
        title, colour = "⚠ FATF 名单无法核验（所有数据源都取不到）", "red"
    else:
        title, colour = "FATF 名单核验通过", "green"

    body = "\n".join(_diff_lines(report)) or "（无明细）"
    card = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {"title": {"tag": "plain_text", "content": title},
                       "template": colour},
            "elements": [
                {"tag": "div", "text": {"tag": "lark_md", "content":
                    f"**基线**：{report.get('baselineDate')} · 黑 "
                    f"{report.get('baselineCounts', {}).get('black')} / 灰 "
                    f"{report.get('baselineCounts', {}).get('grey')}\n"
                    f"**来源**：{report.get('baselineProvenance')}"}},
                {"tag": "hr"},
                {"tag": "div", "text": {"tag": "lark_md", "content": body}},
                {"tag": "hr"},
                {"tag": "div", "text": {"tag": "lark_md", "content":
                    f"请人工核对官网后手工更新基线文件：\n[{FATF_PAGE}]({FATF_PAGE})\n"
                    f"检测时间 {now} · 自动流程不会修改基线"}},
            ],
        },
    }
    try:
        req = urllib.request.Request(
            webhook, data=json.dumps(card).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=25) as r:
            resp = json.loads(r.read() or b"{}")
        if resp.get("code") not in (0, None):
            return {"sent": False, "error": f"Lark returned {resp}"}
        return {"sent": True, "error": None}
    except Exception as e:
        return {"sent": False, "error": f"{type(e).__name__}: {e}"}


def send_mail(report: dict, recipients: list[str]) -> dict:
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.utils import formataddr, formatdate

    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    if not smtp_user or not smtp_password:
        return {"sent": False, "error": "SMTP_USER / SMTP_PASSWORD not configured"}
    if not recipients:
        return {"sent": False, "error": "no recipient"}

    now_bj = datetime.now(TZ_SHANGHAI)
    date_label = now_bj.strftime("%Y-%m-%d")
    reason = report.get("reason")
    if reason == "mismatch":
        subject = f"[AML · 需人工核查] FATF 名单与基线不一致 · {date_label}"
    else:
        subject = f"[AML · 需人工核查] FATF 名单无法核验 · {date_label}"

    lines = _diff_lines(report)
    text = "\n".join([
        subject, "",
        f"基线名单日期：{report.get('baselineDate')}",
        f"基线来源：{report.get('baselineProvenance')}",
        f"基线数量：黑 {report.get('baselineCounts', {}).get('black')} / "
        f"灰 {report.get('baselineCounts', {}).get('grey')}", "",
        "核验结果：", *lines, "",
        f"请人工核对官网：{FATF_PAGE}",
        "确认后手工更新 scripts/data-refresh/seeds/fatf-baseline.json —— 自动流程不会修改基线。",
    ])
    html_lines = "".join(
        f'<div style="font-size:13px;color:#333;line-height:1.7;'
        f'{"margin-left:18px;color:#666" if l.startswith("    ") else ""}">{l.strip()}</div>'
        for l in lines)
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#F7F7F7;font-family:'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#222">
<div style="max-width:660px;margin:0 auto;background:#fff;border-radius:10px;padding:22px 24px 28px">
  <div style="font-size:19px;font-weight:700;color:#B26A00">FATF 名单核验 · 需人工核查</div>
  <div style="font-size:12px;color:#888;margin:6px 0 16px">{date_label} · 自动流程不会修改基线</div>
  <div style="padding:12px 14px;background:#FAFAFA;border:1px solid #EEE;border-radius:8px;font-size:12px;color:#555;line-height:1.7">
    基线名单日期：{report.get('baselineDate')}<br>
    基线来源：{report.get('baselineProvenance')}<br>
    基线数量：黑 {report.get('baselineCounts', {}).get('black')} / 灰 {report.get('baselineCounts', {}).get('grey')}
  </div>
  <div style="margin-top:16px">{html_lines}</div>
  <div style="margin-top:18px;padding-top:12px;border-top:1px solid #EEE;font-size:12px;color:#666">
    请人工核对官网：<a href="{FATF_PAGE}" style="color:#0563C1">{FATF_PAGE}</a><br>
    确认后手工更新 <code>scripts/data-refresh/seeds/fatf-baseline.json</code>。
  </div>
</div></body></html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr(("AML List Watch", smtp_user))
    msg["To"] = ", ".join(recipients)
    msg["Date"] = formatdate(localtime=True)
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=45) as srv:
            srv.ehlo(); srv.starttls(); srv.ehlo()
            srv.login(smtp_user, smtp_password)
            srv.sendmail(smtp_user, recipients, msg.as_string())
        return {"sent": True, "error": None}
    except Exception as e:
        return {"sent": False, "error": f"{type(e).__name__}: {e}"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Report only; never send")
    args = ap.parse_args()

    report = verify()
    print(json.dumps(report, ensure_ascii=False, indent=1))
    for line in _diff_lines(report):
        print(line)

    if report.get("ok"):
        print("FATF 核验通过 —— 与基线一致，不发送告警。")
        return 0

    print(f"::warning::FATF 核验未通过（{report.get('reason')}）—— 触发 Lark + 邮件告警")
    if args.dry_run:
        print("--dry-run: 不发送")
        return 0

    recipients = [a.strip() for a in
                  os.getenv("FATF_REVIEW_RECIPIENT", DEFAULT_REVIEWER)
                  .replace(";", ",").split(",") if a.strip()]
    lark = send_lark(os.getenv("LARK_WEBHOOK", ""), report)
    mail = send_mail(report, recipients)
    print(f"lark: {lark}")
    print(f"mail: {mail} → {recipients}")
    # Alerting failures must not fail the data refresh itself.
    return 0


if __name__ == "__main__":
    sys.exit(main())
