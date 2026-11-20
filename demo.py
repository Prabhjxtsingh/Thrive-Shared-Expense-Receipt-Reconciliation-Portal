"""Fictional data and a printable receipt for the local demo."""

from functools import lru_cache
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from werkzeug.security import generate_password_hash

from ledger import audit, create_revision, post_revision, revision
from reconciliation import blank_draft, preview


SAMPLE_KEY = "demo-dinner.png"


def installed_sample(receipt_dir):
    path = receipt_dir / SAMPLE_KEY
    return path.read_bytes() if path.is_file() else sample_receipt()


def azure_fixture():
    return json.loads(Path(__file__).with_name("fixtures").joinpath("dinner-extraction.json").read_text(encoding="utf-8"))


@lru_cache
def sample_receipt():
    image = Image.new("RGB", (560, 675), "#fcfaf5")
    draw = ImageDraw.Draw(image)
    title = ImageFont.load_default(size=34)
    text = ImageFont.load_default(size=23)
    thin = "#6b675f"
    dark = "#24221e"
    draw.text((280, 58), "THE CAMPUS KITCHEN", font=title, fill=dark, anchor="mm")
    draw.text((280, 104), "INDUSTRIAL VISIT DINNER", font=text, fill=thin, anchor="mm")
    draw.text((280, 144), "17 NOV 2026   /   BILL 026", font=text, fill=thin, anchor="mm")
    for y in (184, 232, 392, 542):
        draw.line((40, y, 520, y), fill="#a49d8c", width=1)
    for y, label, value in (
        (208, "ITEM", "INR"), (272, "2 x Margherita pizza", "400.00"), (320, "Punjabi thali", "250.00"),
        (368, "Drinks", "150.00"), (427, "Subtotal", "800.00"), (475, "Tax", "40.00"),
        (576, "TOTAL", "840.00"),
    ):
        draw.text((42, y), label, font=text, fill=dark, anchor="lm")
        draw.text((518, y), value, font=text, fill=dark, anchor="rm")
    draw.text((280, 634), "Thank you for visiting", font=text, fill=thin, anchor="mm")
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def seed(conn, receipt_dir):
    if conn.execute("SELECT 1 FROM groups LIMIT 1").fetchone():
        return
    from receipt_extraction import normalize_extraction

    users = []
    for name in ("Aman Sharma", "Simran Kaur", "Karan Patel"):
        email = name.split()[0].lower() + "@thrive.demo"
        users.append(conn.execute("INSERT INTO users(name, email, password_hash) VALUES (?, ?, ?)",
                                  (name, email, generate_password_hash("thrive-demo"))).lastrowid)
    aman, simran, karan = users
    group_id = conn.execute("INSERT INTO groups(name, description) VALUES (?, ?)",
                            ("Industrial Visit ’26", "College trip • November 2026")).lastrowid
    conn.executemany("INSERT INTO group_members(group_id, user_id, role) VALUES (?, ?, ?)",
                     [(group_id, person, "organizer" if person == aman else "member") for person in users])
    audit(conn, group_id, aman, "group_created", "Industrial Visit ’26")

    def add(draft, receipt_id=None):
        payer = draft["payer_id"]
        expense_id = conn.execute("INSERT INTO expenses(group_id, receipt_id, created_by) VALUES (?, ?, ?)",
                                  (group_id, receipt_id, payer)).lastrowid
        revision_id = create_revision(conn, expense_id, 1, payer, draft)
        row = conn.execute("SELECT * FROM expense_revisions WHERE id = ?", (revision_id,)).fetchone()
        expense = conn.execute("SELECT * FROM expenses WHERE id = ?", (expense_id,)).fetchone()
        post_revision(conn, expense, row, preview(revision(conn, row), set(users))["shares"], payer)

    add(dict(blank_draft(karan), merchant="Morning coffee", purchase_date="2026-11-16",
             total_paise=24000, member_ids=[karan]))
    add(dict(blank_draft(simran), merchant="Station cab", purchase_date="2026-11-17",
             total_paise=45000, member_ids=[simran]))
    original = sample_receipt()
    key = SAMPLE_KEY
    (receipt_dir / key).write_bytes(original)
    raw = azure_fixture()
    draft, uncertainty = normalize_extraction(raw, aman, users)
    payload = json.dumps(dict(raw=raw, source_draft=draft, uncertainty=uncertainty), ensure_ascii=False)
    receipt_id = conn.execute(
        """INSERT INTO receipts(group_id, uploader_id, file_key, filename, mime_type, file_hash, scan_status, extraction_json)
           VALUES (?, ?, ?, 'campus-kitchen.png', 'image/png', ?, 'ready', ?)""",
        (group_id, aman, key, sha256(original).hexdigest(), payload),
    ).lastrowid
    for item, people in zip(draft["items"], ([aman, simran], [karan], users)):
        item["member_ids"] = people
    add(draft, receipt_id)
