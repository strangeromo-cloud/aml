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
    "lao pdr": "laos",
    # FATF's own Country facet writes "Democratic Republic of Korea", dropping the
    # "People's" that appears in its prose and in Legal's baseline.
    "democratic republic of korea": "north korea",
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
    # Sources vary on the leading article ("the Democratic People's Republic of
    # Korea" vs "Democratic People's Republic of Korea"), which would otherwise miss
    # the alias table entirely.
    s = re.sub(r"^the ", "", s)
    return ALIASES.get(s, s)


_MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], 1)}


def parse_date(text: str | None) -> str | None:
    """Normalise the date forms these sources use into YYYY-MM-DD.

    Baseline writes 2026-06-19, Wikipedia "13 February 2026", FinCEN
    "February 13, 2026". Returns None when nothing parseable is present.
    """
    if not text:
        return None
    t = str(text).strip()
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return m.group(0)
    m = re.search(r"\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b", t)
    if m and m.group(2).lower() in _MONTHS:
        return f"{m.group(3)}-{_MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"\b([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b", t)
    if m and m.group(1).lower() in _MONTHS:
        return f"{m.group(3)}-{_MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}"
    return None


def classify(status: str) -> str:
    s = (status or "").lower()
    return "black" if ("call for action" in s or "black" in s) else "grey"


# Plausibility bounds for any FATF list, whatever produced it. The black list has
# been 1-5 jurisdictions for its entire history and the grey list 10-30.
BLACK_RANGE = (1, 6)
GREY_RANGE = (8, 40)


def validate_rows(rows: list[dict] | None) -> str | None:
    """Return None when the parsed list is plausible, else why it is not.

    Applied to EVERY source, including our own official fetcher — a mis-parsing
    fetcher feeding the comparison would raise a fake "the list changed" alert,
    which is worse than the source being absent.
    """
    if not rows:
        return "无数据"
    sets = as_sets(rows)
    black, grey = sets["black"], sets["grey"]
    if not (BLACK_RANGE[0] <= len(black) <= BLACK_RANGE[1]):
        return f"黑名单 {len(black)} 条，超出合理范围 {BLACK_RANGE}"
    if not (GREY_RANGE[0] <= len(grey) <= GREY_RANGE[1]):
        return f"灰名单 {len(grey)} 条，超出合理范围 {GREY_RANGE}"
    overlap = black & grey
    if overlap:
        return f"同一辖区同时出现在黑灰名单: {', '.join(sorted(overlap))}"
    return None


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
    label = "官方页面（本次抓取）"
    try:
        rows = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        return label, None, f"快照解析失败: {e}"
    bad = validate_rows(rows)
    if bad:
        return label, None, f"抓取结果不可信，已忽略: {bad}"
    pub = next((r.get("publication_date") for r in rows if r.get("publication_date")), None)
    return label, {"rows": rows, "list_date": parse_date(pub),
                   "scope": ("black", "grey")}, None


# FATF publishes after each plenary — February, June and October. archive.org is
# intermittently down (all three of its endpoints returned 5xx while this was
# built), so retry harder in the months where the list can actually move.
PLENARY_MONTHS = (2, 6, 10)


def _wayback_attempts() -> int:
    return 5 if datetime.now(TZ_SHANGHAI).month in PLENARY_MONTHS else 2


# archive.org rejects the plain-http + custom-User-Agent combination: the CDX
# endpoint answers 200 over https with a browser UA and 503 over http with
# "aml-data-refresh/1.0". Always use https and this UA here.
ARCHIVE_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}


def _http(url: str, timeout: int = 40, headers: dict[str, str] | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers or ARCHIVE_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _wayback_stamp() -> tuple[str | None, str | None]:
    """Newest capture timestamp for the FATF page. CDX first — it is the endpoint
    that actually stays up; the availability API has been 502 for a while."""
    bare = FATF_PAGE.split("//", 1)[1]
    try:
        raw = _http("https://web.archive.org/cdx/search/cdx?url=" + bare
                    + "&output=json&limit=-1&filter=statuscode:200&fl=timestamp", 30)
        data = [r for r in json.loads(raw or b"[]") if r and r[0] != "timestamp"]
        if data:
            return data[-1][0], None
        return None, "CDX 无 200 状态的存档"
    except Exception as cdx_err:
        try:
            quoted = urllib.request.quote(FATF_PAGE, safe="")
            meta = json.loads(_http(f"https://archive.org/wayback/available?url={quoted}", 30))
            snap = ((meta.get("archived_snapshots") or {}).get("closest") or {})
            if snap.get("timestamp"):
                return str(snap["timestamp"]), None
        except Exception as avail_err:
            return None, (f"CDX: {type(cdx_err).__name__} / "
                          f"availability: {type(avail_err).__name__}")
    return None, f"CDX: {type(cdx_err).__name__}"


def _wayback_snapshot(attempts: int) -> tuple[str | None, str | None, str | None]:
    """Return (html, stamp, error).

    The index and the replay server fail independently: CDX can answer 200 while
    web.archive.org/web/… returns 503. Report which half failed so a transient
    replay outage is not mistaken for "no archive exists".
    """
    import time
    stamp, stamp_err = _wayback_stamp()
    if not stamp:
        return None, None, f"存档索引查询失败（{stamp_err}）"
    # id_ serves the original bytes without the archive's toolbar injection.
    forms = [f"https://web.archive.org/web/{stamp}id_/{FATF_PAGE}",
             f"https://web.archive.org/web/{stamp}/{FATF_PAGE}"]
    last = "unknown"
    for attempt in range(1, attempts + 1):
        for form in forms:
            try:
                return _http(form, 60).decode("utf-8", "replace"), stamp[:8], None
            except Exception as e:
                last = f"{type(e).__name__}: {str(e)[:60]}"
        if attempt < attempts:
            time.sleep(3 * attempt)
    return None, stamp[:8], (f"存档 {stamp[:8]} 存在，但回放服务器取不到"
                             f"（{last}，尝试 {attempts} 轮）")


def source_wayback() -> tuple[str, list[dict] | None, str | None]:
    """Most recent Wayback capture of the official page — authoritative content,
    just time-shifted. This is the closest thing to the official source we can
    reach while the live page is behind Cloudflare."""
    label = "Wayback 存档（官方页面）"
    html, stamp, err = _wayback_snapshot(_wayback_attempts())
    if html is None:
        return label, None, err
    rows, reason = _parse_fatf_html(html)
    if rows is None:
        # Never hand an unvalidated parse to the comparison: a garbled parse would
        # surface as a fake "list changed" alert, which is worse than no source.
        return f"{label} @ {stamp}", None, f"存档页面解析不可信: {reason}"
    # The capture timestamp is when it was crawled, not the list's own date; take the
    # list date from the page text when it states one.
    m = re.search(r"(\d{1,2}\s+\w+\s+20\d{2}|\w+\s+\d{1,2},?\s+20\d{2})", html[:20000])
    return f"{label} @ {stamp}", {"rows": rows, "list_date": parse_date(m.group(1)) if m else None,
                                  "scope": ("black", "grey")}, None


NAME_RE = re.compile(r"^[A-Z][A-Za-z'\u2019 \-\(\),\.]{2,49}$")
# Words that appear in FATF page navigation and never in a jurisdiction name.
NOT_A_JURISDICTION = re.compile(
    r"\b(fatf|report|statement|publication|document|read|more|home|about|news|"
    r"jurisdiction|monitoring|action|country|countries|list|search|contact|privacy)\b",
    re.I)


def _parse_fatf_html(html: str) -> tuple[list[dict] | None, str]:
    """Pull jurisdiction names from the two FATF sections.

    Returns (rows, reason). rows is None when the result fails plausibility
    checks, so the caller can treat it as "source unusable" rather than as data.
    """
    import html as html_mod
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    buckets: dict[str, list[str]] = {"Call for Action": [], "Increased Monitoring": []}
    for status, pattern in (
        ("Call for Action", r"Call for Action(.*?)(?:Increased Monitoring|</main>)"),
        ("Increased Monitoring", r"Increased Monitoring(.*?)(?:</main>|Documents|</body>)"),
    ):
        m = re.search(pattern, text, re.S | re.I)
        if not m:
            return None, f"页面中找不到 “{status}” 区块"
        for a in re.findall(r"<a[^>]*>(.*?)</a>", m.group(1), re.S):
            name = html_mod.unescape(re.sub(r"<[^>]+>", "", a)).strip()
            if NAME_RE.match(name) and not NOT_A_JURISDICTION.search(name):
                buckets[status].append(name)

    rows = ([{"status": "Call for Action", "country": n} for n in buckets["Call for Action"]]
            + [{"status": "Increased Monitoring", "country": n}
               for n in buckets["Increased Monitoring"]])
    bad = validate_rows(rows)
    if bad:
        return None, bad
    return rows, "ok"


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

    bad = validate_rows(rows)
    if bad:
        return label, None, f"解析结果不可信: {bad}"
    as_of = parse_date(dates[0]) if dates else None
    suffix = f" @ as of {dates[0]}" if dates else ""
    return f"{label}{suffix}", {"rows": rows, "list_date": as_of,
                                "scope": ("black", "grey")}, None


# ── FinCEN: US Treasury republication of each plenary outcome ────────────
# Not behind Cloudflare, and one release per plenary with an incrementing slug, so
# the newest is found by probing until 404. It states the black list in full but
# only the grey-list *changes*, hence scope=("black",) — see compare().
FINCEN_BASE = ("https://www.fincen.gov/news/news-releases/"
               "financial-action-task-force-identifies-jurisdictions-anti-money-laundering")
FINCEN_MAX_PROBE = 12


def _fincen_text(url: str) -> str | None:
    try:
        raw = _http(url, 30, headers={"User-Agent": "aml-data-refresh/1.0",
                                      "Accept": "text/html"}).decode("utf-8", "replace")
    except Exception:
        return None
    import html as html_mod
    stripped = re.sub(r"<script.*?</script>|<style.*?</style>|<[^>]+>", " ", raw, flags=re.S)
    return re.sub(r"\s+", " ", html_mod.unescape(stripped))


def source_fincen() -> tuple[str, dict | None, str | None]:
    label = "FinCEN（美国财政部转载）"
    newest_text, newest_url = None, None
    for i in range(FINCEN_MAX_PROBE):
        url = FINCEN_BASE if i == 0 else f"{FINCEN_BASE}-{i}"
        t = _fincen_text(url)
        if t is None:
            break          # first 404 ends the series; the previous one is newest
        newest_text, newest_url = t, url
    if not newest_text:
        return label, None, "FinCEN 页面取不到"

    plenary = parse_date(
        (re.search(r"On (\w+ \d{1,2}, \d{4}), the FATF", newest_text) or [None, None])[1]
        if re.search(r"On (\w+ \d{1,2}, \d{4}), the FATF", newest_text) else None)
    released = parse_date(
        (re.search(r"Immediate Release\s*(\w+ \d{1,2},? \d{4})", newest_text) or [None, None])[1]
        if re.search(r"Immediate Release\s*(\w+ \d{1,2},? \d{4})", newest_text) else None)

    # "...Call for Action remains the same, with Iran, the Democratic People's
    # Republic of Korea (DPRK), and Burma subject to calls for action."
    m = re.search(r"Call for Action[^.]*?with (.{0,220}?) subject to calls for action",
                  newest_text, re.S)
    if not m:
        return label, None, "FinCEN 文本里找不到黑名单句式（页面措辞可能已变）"
    seg = re.sub(r"\(([^)]*)\)", r", \1", m.group(1))          # DPRK 等括号别名拆出来
    names = [n.strip(" ,.") for n in re.split(r",| and ", seg) if n.strip(" ,.")]
    rows = [{"status": "Call for Action", "country": n} for n in names]
    black = as_sets(rows)["black"]
    if not (BLACK_RANGE[0] <= len(black) <= BLACK_RANGE[1]):
        return label, None, f"FinCEN 解析出 {len(black)} 条黑名单，超出合理范围 {BLACK_RANGE}"

    suffix = f" @ 全会 {plenary}" if plenary else ""
    return f"{label}{suffix}", {
        "rows": rows, "list_date": plenary, "released": released,
        "scope": ("black",), "url": newest_url,
    }, None


SOURCES = [source_fresh_fetch, source_wikipedia, source_fincen, source_wayback]


# ── Comparison ──────────────────────────────────────────────────────────

def compare(baseline: dict[str, set[str]], candidate: dict[str, set[str]],
            scope: tuple[str, ...] = ("black", "grey")) -> dict:
    """Diff only the lists a source actually publishes.

    FinCEN states the full black list but only the grey-list *changes*, so diffing
    its grey set against the baseline would report the whole grey list as removed.
    """
    res: dict = {"scope": list(scope)}
    for key in ("black", "grey"):
        if key not in scope:
            res[key] = {"added": [], "removed": [], "skipped": True}
            continue
        res[key] = {
            "added": sorted(candidate[key] - baseline[key]),
            "removed": sorted(baseline[key] - candidate[key]),
            "skipped": False,
        }
    res["identical"] = not any(res[k]["added"] or res[k]["removed"] for k in scope)
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
    base_date = parse_date(seed.get("listDate"))
    report["baselineDate"] = seed.get("listDate")
    for fn in SOURCES:
        label, payload, err = fn()
        if payload is None:
            report["sources"].append({"label": label, "reachable": False, "error": err})
            continue
        # Sources return either a bare row list or a payload dict.
        if isinstance(payload, dict):
            rows = payload.get("rows") or []
            scope = tuple(payload.get("scope") or ("black", "grey"))
            list_date = payload.get("list_date")
        else:
            rows, scope, list_date = payload, ("black", "grey"), None
        cand = as_sets(rows)
        diff = compare(baseline, cand, scope)

        # FATF republishes three times a year, and every mirror lags the plenary by
        # days to weeks. Without this, each plenary would produce weeks of false
        # "the list changed" alerts against a freshly updated baseline.
        if list_date and base_date and list_date < base_date:
            staleness = "source_behind"
        elif list_date and base_date and list_date > base_date:
            staleness = "baseline_behind"
        elif list_date and base_date:
            staleness = "same_date"
        else:
            staleness = "unknown_date"

        report["sources"].append({
            "label": label, "reachable": True,
            "counts": {k: len(v) for k, v in cand.items()},
            "scope": list(scope), "listDate": list_date, "staleness": staleness,
            "identical": diff["identical"], "diff": diff,
        })

    reachable = [x for x in report["sources"] if x["reachable"]]
    if not reachable:
        report["ok"] = False
        report["reason"] = "no_source"
        return report

    # A source that predates the baseline disagreeing with it is expected, not an
    # anomaly — the baseline is simply newer. Only these are worth waking someone:
    baseline_behind = [x for x in reachable
                       if x["staleness"] == "baseline_behind" and not x["identical"]]
    same_date_conflict = [x for x in reachable
                          if x["staleness"] == "same_date" and not x["identical"]]
    unknown_conflict = [x for x in reachable
                        if x["staleness"] == "unknown_date" and not x["identical"]]
    report["behind"] = [x["label"] for x in reachable if x["staleness"] == "source_behind"]

    if same_date_conflict:
        report["ok"] = False
        report["reason"] = "same_date_conflict"
    elif baseline_behind:
        report["ok"] = False
        report["reason"] = "baseline_behind"
    elif unknown_conflict:
        report["ok"] = False
        report["reason"] = "mismatch"
    else:
        report["ok"] = True
        report["reason"] = "identical" if not report["behind"] else "sources_behind_baseline"
    return report


# ── Alerting ────────────────────────────────────────────────────────────

STALENESS_CN = {
    "source_behind": "该源比基线旧（基线更新，属正常）",
    "baseline_behind": "**该源比基线新 —— 基线可能已过期**",
    "same_date": "同一名单日期",
    "unknown_date": "名单日期未知",
}


def _diff_lines(report: dict) -> list[str]:
    lines: list[str] = []
    for s in report.get("sources", []):
        if not s["reachable"]:
            lines.append(f"· {s['label']}：取不到 —— {s.get('error')}")
            continue
        scope = s.get("scope") or ["black", "grey"]
        counts = " / ".join(
            f"{'黑' if k == 'black' else '灰'} {s['counts'][k]}" for k in scope)
        cover = "" if len(scope) == 2 else "（仅覆盖黑名单）"
        date_note = f"名单日期 {s.get('listDate') or '未知'} · {STALENESS_CN.get(s.get('staleness'), '')}"
        verdict = "与基线一致" if s["identical"] else "**与基线不一致**"
        lines.append(f"· {s['label']}：{verdict}（{counts}）{cover}")
        lines.append(f"    {date_note}")
        if s["identical"]:
            continue
        for key, cn in (("black", "黑名单"), ("grey", "灰名单")):
            d = s["diff"][key]
            if d.get("skipped"):
                continue
            if d["added"]:
                lines.append(f"    {cn} 该源有、基线无：{', '.join(d['added'])}")
            if d["removed"]:
                lines.append(f"    {cn} 基线有、该源无：{', '.join(d['removed'])}")
    return lines


def send_lark(webhook: str, report: dict) -> dict:
    """Post an interactive card to a Lark incoming webhook (cct lark_client pattern).

    A Lark custom bot can be configured with 自定义关键词 validation, which rejects
    any message not containing one of its keywords with code 19024. Set
    LARK_KEYWORD to that word and it is appended to the card so the check passes.
    """
    if not webhook:
        return {"sent": False, "error": "LARK_WEBHOOK not configured"}
    now = datetime.now(TZ_SHANGHAI).strftime("%Y-%m-%d %H:%M")
    keyword = os.getenv("LARK_KEYWORD", "").strip()
    reason = report.get("reason")
    TITLES = {
        "same_date_conflict": ("🚨 FATF 名单同日期内容冲突，需立即人工核查", "red"),
        "baseline_behind": ("⚠ 有数据源比基线更新 —— 基线可能已过期", "orange"),
        "mismatch": ("⚠ FATF 名单与基线不一致（名单日期未知），需人工核查", "orange"),
        "no_source": ("⚠ FATF 名单无法核验（所有数据源都取不到）", "red"),
        "sources_behind_baseline": ("FATF 核验通过（部分数据源滞后于基线）", "green"),
        "identical": ("FATF 名单核验通过", "green"),
    }
    title, colour = TITLES.get(reason, ("FATF 名单核验", "grey"))

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
                    f"检测时间 {now} · 自动流程不会修改基线"
                    + (f"\n{keyword}" if keyword else "")}},
            ],
        },
    }
    try:
        req = urllib.request.Request(
            webhook, data=json.dumps(card).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=25) as r:
            resp = json.loads(r.read() or b"{}")
        if resp.get("code") == 19024:
            return {"sent": False, "error": (
                "Lark 自定义关键词校验未通过（19024）。把机器人改为无校验/签名校验，"
                "或把关键词设进 LARK_KEYWORD secret。")}
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
    SUBJ = {
        "same_date_conflict": "FATF 名单同日期内容冲突",
        "baseline_behind": "有数据源比基线更新，基线可能过期",
        "mismatch": "FATF 名单与基线不一致（名单日期未知）",
        "no_source": "FATF 名单无法核验",
    }
    subject = f"[AML · 需人工核查] {SUBJ.get(reason, 'FATF 核验异常')} · {date_label}"

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
