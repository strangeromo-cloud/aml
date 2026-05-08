"""Tiny Playwright wrapper for fetchers that need a JS-rendered page.

Goals:
  - One-line fetch_rendered_html(url, wait_selector, timeout) call sites
  - Realistic browser fingerprint so we're not blocked as a bot
  - Capture a screenshot + HTML on failure under /tmp for triage
  - Hard timeout so a wedged page can't hang the daily run
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import (
    Browser,
    Page,
    Playwright,
    TimeoutError as PlaywrightTimeout,
    sync_playwright,
)

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.119 Safari/537.36"
)
DEFAULT_VIEWPORT = {"width": 1440, "height": 900}
DEBUG_DIR = Path("/tmp/data-refresh-debug")


class HeadlessError(RuntimeError):
    """Raised when a Playwright fetch cannot deliver."""


def _save_debug(page: Page, slug: str) -> None:
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    try:
        page.screenshot(path=str(DEBUG_DIR / f"{slug}-{ts}.png"), full_page=True)
    except Exception:
        pass
    try:
        (DEBUG_DIR / f"{slug}-{ts}.html").write_text(page.content() or "")
    except Exception:
        pass


def fetch_rendered_html(
    url: str,
    *,
    wait_selector: str | None = None,
    extra_settle_ms: int = 800,
    timeout_ms: int = 45_000,
    debug_slug: str = "page",
    on_page: Any | None = None,
    logger: logging.Logger | None = None,
) -> str:
    """Render a URL with headless Chromium and return the final HTML.

    Args:
      url:             URL to load
      wait_selector:   CSS selector to wait for before we believe the page is
                       ready. Strongly recommended — without it we just guess.
      extra_settle_ms: After the selector resolves, wait this many ms for any
                       follow-up XHRs to finish.
      timeout_ms:      Hard ceiling for the whole interaction.
      debug_slug:      Filename slug for debug screenshots / dumps.
      on_page:         Optional callable(page) -> None invoked after navigation
                       and selector wait, before we read the HTML. Useful for
                       clicking expand-buttons, switching tabs, etc.
    """
    log = logger or logging.getLogger("data-refresh")
    with sync_playwright() as pw:  # type: Playwright
        browser: Browser = pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            ctx = browser.new_context(
                user_agent=DEFAULT_USER_AGENT,
                viewport=DEFAULT_VIEWPORT,
                locale="en-US",
            )
            page = ctx.new_page()
            page.set_default_timeout(timeout_ms)
            page.set_default_navigation_timeout(timeout_ms)
            try:
                page.goto(url, wait_until="domcontentloaded")
                if wait_selector:
                    page.wait_for_selector(wait_selector, state="visible", timeout=timeout_ms)
                if extra_settle_ms:
                    page.wait_for_timeout(extra_settle_ms)
                if on_page is not None:
                    on_page(page)
                html = page.content()
                if not html or len(html) < 500:
                    _save_debug(page, debug_slug)
                    raise HeadlessError(f"Rendered HTML too small ({len(html)} chars) for {url}")
                return html
            except PlaywrightTimeout as e:
                _save_debug(page, debug_slug)
                raise HeadlessError(f"Timeout rendering {url}: {e}")
            except Exception as e:
                _save_debug(page, debug_slug)
                raise HeadlessError(f"Headless fetch of {url} failed: {type(e).__name__}: {e}")
        finally:
            browser.close()
