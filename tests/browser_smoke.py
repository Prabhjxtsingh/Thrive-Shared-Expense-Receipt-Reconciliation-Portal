"""Exercise the dinner workflow in Chromium against an isolated demo database."""

from argparse import ArgumentParser
from io import BytesIO
import logging
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import Event, Thread

from playwright.sync_api import expect, sync_playwright
from PIL import Image, ImageDraw, ImageFont
from werkzeug.serving import make_server

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
from app import create_app
from demo import sample_receipt
from receipt_extraction import start_worker


def check_site(base_url, screenshots):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1050})
        page.set_default_timeout(8000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base_url)
        expect(page.get_by_role("heading", name="Overview", exact=True)).to_be_visible()
        expect(page.locator(".hero-balance strong")).to_have_text("₹577.50")
        expect(page.get_by_role("button", name="Open navigation")).to_be_hidden()
        dinner = page.locator(".data-table").get_by_role("link", name="The Campus Kitchen")
        expect(dinner).to_be_visible()
        if screenshots:
            page.screenshot(path=screenshots / "overview.png", full_page=True)
        dinner.click()
        expect(page.get_by_role("heading", name="Posted expense")).to_be_visible()
        expect(page.get_by_alt_text("Original receipt for campus-kitchen.png")).to_be_visible()
        posted = page.locator("section.card").filter(has=page.get_by_role("heading", name="Posted expense"))
        expect(posted.get_by_text("₹315.00", exact=True)).to_be_visible()

        page.get_by_role("button", name="Account menu").click()
        page.get_by_role("button", name="Simran", exact=True).click()
        page.get_by_role("link", name="Balances", exact=True).click()
        expect(page.get_by_role("heading", name="Balances", exact=True)).to_be_visible()
        page.get_by_role("button", name="Record", exact=True).click()
        expect(page.get_by_label("Amount (₹)")).to_have_value("262.50")
        page.get_by_role("dialog").get_by_role("button", name="Record payment").click()
        expect(page.get_by_text("Awaiting recipient")).to_be_visible()
        page.get_by_role("button", name="Account menu").click()
        page.get_by_role("button", name="Aman", exact=True).click()
        page.get_by_role("button", name="Confirm receipt").click()
        page.get_by_role("button", name="Confirm received").click()
        expect(page.get_by_text("Confirmed", exact=True)).to_be_visible()
        expect(page.locator(".balance-row").filter(has_text="Simran Kaur")).to_contain_text("₹0.00")

        page.get_by_role("link", name="Expenses", exact=True).click()
        page.get_by_role("link", name="The Campus Kitchen").click()
        page.get_by_role("button", name="Ask a question").click()
        page.get_by_label("Receipt item").select_option(label="Drinks")
        page.get_by_label("What should the group review?").fill("Karan did not share the drinks.")
        page.get_by_role("button", name="Submit question").click()
        expect(page.get_by_text("Karan did not share the drinks.")).to_be_visible()
        page.get_by_role("button", name="Propose correction").click()
        group = page.get_by_role("group", name="Participants for Drinks")
        group.get_by_role("checkbox", name="Karan").uncheck()
        expect(page.get_by_role("heading", name="Proposed shares")).to_be_visible()
        page.get_by_role("button", name="Approve correction").click()
        expect(page.get_by_text("Version 2 · Current · ₹840.00")).to_be_visible()

        page.get_by_role("link", name="Receipts", exact=True).click()
        page.get_by_role("button", name="Upload receipt").click()
        page.locator('input[type="file"]').set_input_files(
            {"name": "sample.png", "mimeType": "image/png", "buffer": sample_receipt()})
        page.get_by_role("dialog").get_by_role("button", name="Upload receipt").click()
        expect(page.get_by_text("Scan ready", exact=True)).to_be_visible(timeout=8000)
        expect(page.get_by_label("Merchant", exact=True)).to_have_value("The Campus Kitchen")
        page.get_by_role("group", name="Participants for Margherita pizza").get_by_role("checkbox", name="Aman").check()
        page.get_by_role("group", name="Participants for Margherita pizza").get_by_role("checkbox", name="Simran").check()
        page.get_by_role("group", name="Participants for Punjabi thali").get_by_role("checkbox", name="Karan").check()
        for name in ("Aman", "Simran", "Karan"):
            page.get_by_role("group", name="Participants for Drinks").get_by_role("checkbox", name=name).check()
        page.get_by_role("button", name="Remove adjustment 1").click()
        expect(page.get_by_text("₹40.00 unaccounted for", exact=False)).to_be_visible()
        page.get_by_role("button", name="Add adjustment").click()
        page.get_by_label("Amount (₹)", exact=True).fill("40")
        expect(page.get_by_text("Shares match the reviewed receipt total.")).to_be_visible()
        page.get_by_role("button", name="Save draft").click()
        expect(page.get_by_role("status").filter(has_text="Draft saved.")).to_be_visible()
        page.reload()
        expect(page.get_by_role("group", name="Participants for Drinks").get_by_role("checkbox", name="Karan")).to_be_checked()
        expect(page.get_by_label("Amount (₹)", exact=True)).to_have_value("40.00")
        if screenshots:
            page.screenshot(path=screenshots / "receipt-review.png", full_page=True)

        page.get_by_role("link", name="Expenses", exact=True).click()
        page.get_by_role("button", name="New expense").click()
        expect(page.get_by_role("heading", name="New expense", exact=True)).to_be_visible()
        page.get_by_label("Merchant", exact=True).fill("Workshop registration")
        page.get_by_label("Purchase date").fill("2026-11-20")
        page.get_by_label("Receipt total (₹)").fill("100")
        expect(page.get_by_text("An extra paise goes to Aman.")).to_be_visible()
        page.get_by_role("button", name="Post expense").click()
        expect(page.get_by_role("heading", name="Posted expense")).to_be_visible()
        posted = page.locator("section.card").filter(has=page.get_by_role("heading", name="Posted expense"))
        expect(posted.get_by_text("₹33.34", exact=True)).to_be_visible()

        page.get_by_role("link", name="Receipts", exact=True).click()
        page.get_by_role("button", name="Upload receipt").click()
        pdf_buffer = BytesIO()
        image = Image.new("RGB", (500, 600), "#ffffff")
        ImageDraw.Draw(image).text((30, 30), "THRIVE PDF RECEIPT", fill="#151d32", font=ImageFont.load_default(size=35))
        second = Image.new("RGB", (500, 600), "#fff5e5")
        ImageDraw.Draw(second).text((30, 30), "RECEIPT PAGE TWO", fill="#151d32", font=ImageFont.load_default(size=35))
        image.save(pdf_buffer, format="PDF", save_all=True, append_images=[second])
        page.locator('input[type="file"]').set_input_files(
            {"name": "private.pdf", "mimeType": "application/pdf", "buffer": pdf_buffer.getvalue()})
        with page.expect_response(lambda response: response.url.endswith("/pdf-preview/1")) as preview:
            page.get_by_role("dialog").get_by_role("button", name="Upload receipt").click()
        assert preview.value.ok
        assert preview.value.headers["content-type"] == "image/png"
        expect(page.get_by_alt_text("Original PDF receipt, page 1")).to_have_js_property("complete", True)
        assert page.get_by_alt_text("Original PDF receipt, page 1").evaluate("image => image.naturalWidth") > 0
        expect(page.get_by_role("link", name="Open PDF")).to_be_visible()
        expect(page.get_by_role("button", name="Retry scan")).to_be_visible(timeout=8000)
        page.get_by_role("button", name="Next page").click()
        expect(page.get_by_text("Page 2 of 2")).to_be_visible()
        expect(page.get_by_alt_text("Original PDF receipt, page 2")).to_have_js_property("complete", True)
        assert page.get_by_alt_text("Original PDF receipt, page 2").evaluate("image => image.naturalWidth") > 0
        if screenshots:
            page.locator(".receipt-panel").screenshot(path=screenshots / "pdf-preview.png")

        mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        mobile.goto(base_url)
        expect(mobile.locator(".hero-balance strong")).to_be_visible()
        assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Mobile viewport scrolls sideways"
        assert mobile.locator(".expense-table").evaluate(
            "table => table.scrollWidth <= table.parentElement.clientWidth"), "Mobile expense status is clipped"
        mobile.get_by_role("button", name="Open navigation").click()
        mobile.get_by_role("link", name="Members", exact=True).click()
        expect(mobile.get_by_role("heading", name="Members", exact=True)).to_be_visible()
        assert not errors, errors
        if screenshots:
            mobile.goto(base_url)
            expect(mobile.locator(".hero-balance strong")).to_be_visible()
            mobile.screenshot(path=screenshots / "mobile-overview.png", full_page=True)
        browser.close()


if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    instance = PROJECT / "instance"
    instance.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=instance) as directory:
        app = create_app({"DEMO": True, "DATA_DIR": Path(directory), "AZURE_ENDPOINT": "", "AZURE_KEY": ""})
        server = make_server("127.0.0.1", 0, app, threaded=True)
        serving = Thread(target=server.serve_forever, daemon=True)
        serving.start()
        stop = Event()
        worker = start_worker(app, stop)
        try:
            check_site(f"http://127.0.0.1:{server.server_port}", args.screenshots)
            print("Chromium desktop and mobile workflow passed.")
        finally:
            stop.set()
            worker.join()
            server.shutdown()
            server.server_close()
            serving.join()
