# Thrive Shared Expense & Receipt Reconciliation Portal

Thrive turns a group receipt into reviewed member shares and a ledger of confirmed payments. It supports INR, one payer per expense, and manually recorded payments.

## Run locally

Use Python 3.11 or later. From this directory, install the runtime requirements and start the demo.

```powershell
python -m pip install -r requirements.txt
python app.py --demo
```

Open [Thrive on localhost](http://127.0.0.1:5050). The demo opens as Aman Sharma and uses fictional data in `instance/demo`. Run `python app.py` for a separate workspace with account registration. Use `--port 5051` if port 5050 is taken.

## Three-person demo

1. Open **The Campus Kitchen** under **Recent expenses**. The ₹840 receipt has pizza for Aman and Simran, thali for Karan, and drinks for all three. The ₹40 tax is allocated proportionally. Aman and Simran each have a ₹262.50 share and Karan has a ₹315.00 share.
2. Open the **Account menu**, switch to **Simran**, and select **Balances**. Record the ₹262.50 suggested transfer to Aman. The payment appears as pending.
3. Switch back to **Aman**. Confirm receipt of the payment. Simran’s balance is now zero and Aman has ₹315.00 to receive from Karan.
4. Reopen the expense, ask a question about **Drinks**, and propose a correction. Remove Karan from the drinks assignment. Compare the proposed shares with the posted shares. As Aman, approve the correction and resolve the question. Revision history and the confirmed payment remain visible.
5. To demonstrate receipt processing, download the sample from the **Upload receipt** dialog and upload it. The demo worker fills the new draft from a saved extraction response. The existing sample triggers a duplicate warning. Assign the items and remove the tax adjustment to expose the ₹40.00 difference, then add the tax back. Use a separate group if you also want to post the new draft.

## Runtime and storage

- Flask serves the UI and API. SQLite stores group memberships, draft versions, posted shares, confirmed payments, and audit events.
- Receipt originals are written under `instance/` and served through group-authorized routes. Uploads accept up to 10 MB of JPEG, PNG, or PDF. PDFium renders private page images for side-by-side review. The queue persists in SQLite, and expired job leases can be reclaimed.
- `reconciliation.py` validates totals and calculates shares in integer paise. `ledger.py` projects balances from the current posted revision and confirmed settlements. `receipt_extraction.py` normalizes the model response and retains the extracted values for review.
- Running `python app.py` starts the web process and receipt worker together. With a WSGI host, use `app:create_app()` and run `flask --app app worker` against the same writable instance directory. For HTTPS, configure `THRIVE_SECRET_KEY` and `THRIVE_HTTPS=1`.

### Azure receipt scanning

Set `DOCUMENTINTELLIGENCE_ENDPOINT` and `DOCUMENTINTELLIGENCE_API_KEY` in the backend environment and restart the server and worker. Thrive sends originals to the Azure Document Intelligence `prebuilt-receipt` model. When credentials are absent or scanning fails, the reviewer can retry or complete the draft manually. The supplied demo receipt always uses the saved response in demo mode. [Microsoft’s streaming REST API](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document-from-stream?view=rest-aiservices-v4.0%2B%282024-11-30%29)

## Verification

```powershell
python -m unittest discover -s tests -v
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python tests/browser_smoke.py
python evaluate_extraction.py fixtures/evaluation.jsonl
```

The acceptance test uploads the ₹840 receipt into a fresh group, scans the saved response, reconciles the tax, and checks the three shares and ledger. It exercises stale saves, simultaneous retries of Post and Confirm, unauthorized file access, and correction after payment. The split tests check 400 randomized allocations for rounding and exact totals. The browser smoke test runs the workflow in an isolated database and checks the mobile layout.

### Extraction evaluation

| Dataset | Receipts | Merchant | Date | Total | Matched line amounts | Flagged for review |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fictional Thrive dinner fixture | 1 | 1/1 | 1/1 | 1/1 | 3/3 | 0/1 |

These figures exercise normalization with a saved response. Live Azure and public dataset accuracy remain unmeasured.

For a labeled corpus, provide a JSON Lines manifest in the format of `fixtures/evaluation.jsonl`. Each row names a dataset, a saved response file relative to the manifest, and its expected fields. Use ISO dates and integer hundredths of the printed currency. For offline evaluation, a row can declare its printed currency, such as `"currency":"IDR"` for CORD. The portal still accepts INR expenses. The evaluator reports coverage separately from amount accuracy for matched descriptions. Its manual-review count marks mismatches, failed scans, and low-confidence fields.

For the AI-900 project report, describe OCR and structured extraction in the receipt review, human verification alongside the original, and who posted or approved each revision. Use public receipt labels for extraction evaluation and retain the separate ledger invariants for financial correctness. [CORD by NAVER CLOVA](https://github.com/clovaai/cord)
