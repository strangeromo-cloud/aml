"""Run every list-source fetcher and write data/downloads/_manifest.json.

Designed to be invoked by GitHub Actions on a daily cron. Exits with code 0
even if some fetchers fail — the per-source status is captured in the manifest
and a separate workflow step inspects it to decide whether to open an issue.

Usage:
  python -m scripts.data-refresh.refresh_all
  python -m scripts.data-refresh.refresh_all --strict   # exit non-zero on any failure
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from .common import OUTPUT_DIR, load_manifest, save_manifest, run_fetcher, setup_logger
from .fetchers import ALL_FETCHERS


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true",
                        help="Exit non-zero if any fetcher fails")
    parser.add_argument("--only", action="append",
                        help="Restrict to specific fetcher ids (can repeat)")
    parser.add_argument("--include-headless", action="store_true",
                        help="Also run fetchers that require a headless browser "
                             "(skipped by default to avoid daily noise)")
    args = parser.parse_args()

    logger = setup_logger()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Carry forward prior state so partial runs don't lose history
    manifest = load_manifest()
    sources = dict(manifest.get("sources", {}))

    fetchers = ALL_FETCHERS
    if args.only:
        wanted = set(args.only)
        fetchers = [f for f in ALL_FETCHERS if f.id in wanted]
        if not fetchers:
            logger.error(f"--only matched no fetchers: {args.only}")
            return 2
    elif not args.include_headless:
        skipped = [f.id for f in fetchers if f.requires_headless]
        fetchers = [f for f in fetchers if not f.requires_headless]
        if skipped:
            logger.info(f"Skipping (requires_headless): {', '.join(skipped)}")

    logger.info(f"Running {len(fetchers)} fetchers")
    fail_count = 0
    for f in fetchers:
        entry = run_fetcher(f, logger)
        sources[f.id] = entry
        if entry.get("status") != "success":
            fail_count += 1

    manifest = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "totalFetchers": len(fetchers),
        "successCount": len(fetchers) - fail_count,
        "failureCount": fail_count,
        "sources": sources,
    }
    save_manifest(manifest)

    logger.info(f"Done. Success: {len(fetchers) - fail_count} / {len(fetchers)} "
                f"(failures: {fail_count})")

    if fail_count and args.strict:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
