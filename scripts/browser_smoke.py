"""Optional UI check: install playwright; uses an existing Chrome executable.

Run a local InvoiceLens server first, then:
python scripts/browser_smoke.py --url http://127.0.0.1:8011
Screenshots are saved under ignored reports/. No browser download is required.
"""
import argparse
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from invoicelens.samples import make_sample, sample_pdf


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8011")
    parser.add_argument("--browser", default=os.environ.get("CHROME_PATH", r"C:\Program Files\Google\Chrome\Application\chrome.exe"))
    args = parser.parse_args()
    reports = Path(__file__).resolve().parents[1] / "reports"
    reports.mkdir(exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1100}, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url)
        expect(page.locator("#filename")).to_have_text("fleet-service.json")
        expect(page.locator("#status-badge")).to_have_text("Checks passed")
        expect(page.locator("#line-items tr")).to_have_count(3)
        page.screenshot(path=str(reports / "workspace-desktop.png"), full_page=True)

        page.locator(".line-button").first.click()
        expect(page.locator(".line-selected")).to_have_count(1)
        expect(page.locator("#clear-highlight")).to_be_visible()
        page.locator("#original-view").click()
        expect(page.locator("#pdf-preview")).to_be_visible()
        page.locator("#word-view").click()
        page.locator("#json-tab").click()
        expect(page.locator("#json-view")).to_be_visible()
        page.locator("#details-tab").click()
        with page.expect_download() as download:
            page.locator("#export-button").click()
        exported = json.loads(Path(download.value.path()).read_text())
        assert exported["total"] == "423.50"
        assert len(exported["line_items"]) == 3

        page.locator('[data-sample="side-by-side"]').click()
        expect(page.locator("#filename")).to_have_text("side-by-side.json")
        expect(page.locator("#line-items tr")).to_have_count(4)
        page.locator('[data-sample="review-required"]').click()
        expect(page.locator("#status-badge")).to_have_text("Needs review")
        expect(page.locator("#review-flags")).to_contain_text("Low OCR confidence")
        expect(page.locator("#review-flags")).to_contain_text("difference 10.00")
        page.screenshot(path=str(reports / "workspace-review.png"), full_page=True)

        page.locator("#more-samples").select_option("multi-page")
        expect(page.locator("#filename")).to_have_text("multi-page.json")
        page.locator(".line-button").last.click()
        expect(page.locator("#page-select")).to_have_value("2")

        page.locator("#file-input").set_input_files({"name": "browser-upload.pdf", "mimeType": "application/pdf", "buffer": sample_pdf(make_sample("fleet-service"))})
        expect(page.locator("#filename")).to_have_text("browser-upload.pdf")
        expect(page.locator("#status-badge")).to_have_text("Checks passed")
        expect(page.locator("#line-items tr")).to_have_count(3)
        page.locator("#export-format").select_option("csv")
        with page.expect_download() as download:
            page.locator("#export-button").click()
        assert "Engine oil & filter" in Path(download.value.path()).read_text()

        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(reports / "workspace-mobile.png"), full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "Mobile layout overflows"
        page.locator("#guide-button").click()
        expect(page.locator("#guide-dialog")).to_be_visible()
        page.locator("#close-guide").click()

        page.locator("#file-input").set_input_files({"name": "broken.pdf", "mimeType": "application/pdf", "buffer": b"broken"})
        expect(page.locator("#error")).to_contain_text("valid PDF")
        expect(page.locator("#filename")).to_have_text("browser-upload.pdf")
        assert not errors, errors
        browser.close()
    print("Browser smoke checks passed: samples, source highlighting, JSON/CSV exports, multi-page navigation, PDF upload, mobile layout, guide, and error handling.")
    print(f"Screenshots: {reports}")


if __name__ == "__main__":
    main()

