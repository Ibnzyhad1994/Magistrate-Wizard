from pathlib import Path
import re
from playwright.sync_api import sync_playwright

assets = Path(__file__).resolve().parents[1] / "assets"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    for svg_path in sorted(assets.glob("*.svg")):
        svg = svg_path.read_text(encoding="utf-8")
        match = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg)
        width, height = (int(match.group(1)), int(match.group(2))) if match else (1280, 720)
        page.set_viewport_size({"width": width + 16, "height": height + 16})
        page.set_content(
            f'<html><body style="margin:0;background:#fff">{svg}</body></html>',
            wait_until="load",
        )
        out = svg_path.with_suffix(".png")
        page.locator("svg").first.screenshot(path=str(out))
        print(f"{svg_path.name} -> {out.name} ({width}x{height})")
    browser.close()
