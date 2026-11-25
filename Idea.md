## 6. InvoiceLens: Rule-Based Invoice Line-Item Extractor (No LLM)

**Category:** Document AI, OCR, Python data extraction

**Business value:** Companies that handle lots of supplier invoices (fleets, repair shops, accounting firms, logistics) still type line items in by hand. That's slow and full of mistakes. InvoiceLens reads scanned or PDF invoices and pulls out the shop, invoice details and every charge line automatically, with no LLM costs, no data leaving the server, and a review flag on anything it isn't sure about. Many clients prefer rule-based systems because they are cheap to run, predictable and private.

**What it does:** Upload invoices from many different vendors. It extracts vendor name, invoice number, date, total and every line item with its amount, checks the maths, and flags any invoice that needs a human to look at it.

**Job types it matches:** OCR / document extraction, invoice and receipt parsing, Python data pipelines, rule-based NLP, accounting and logistics automation, "no LLM" extraction jobs (like the truck repair invoice job).

**Features**
- Works from OCR words + bounding boxes (and the text layer of digital PDFs)
- Groups words into rows and finds the line-item table automatically
- Finds amount columns by geometry (right-aligned numbers), so abbreviated or two-line headings don't break it
- Attaches each amount to the right row, including multi-line descriptions
- Tells charge rows apart from subtotal, tax and total rows (by labels and by maths)
- Handles side-by-side tables (parts / labour), job blocks with their own subtotals, totals boxes, and tables that continue across pages
- Maths check: lines add up to the subtotal, subtotal + tax = total; anything wrong gets a needs-review flag
- Scoring script: per-field accuracy against ground truth
- No templates per vendor, no LLM, no paid services

**Tech stack**
- Python 3.11
- Tesseract or PaddleOCR (free) for scans; pdfplumber / PyMuPDF for digital PDFs
- NumPy for row and column clustering
- pytest for unit tests with made-up data for every rule
- FastAPI + simple upload page for the demo

**Build steps**
1. Collect 40 to 60 public invoices from different vendors (public-record receipts, sample invoice datasets such as SROIE or CORD) and write ground-truth JSON for each
2. Run OCR and save words + boxes as JSON
3. Build row grouping, then table detection, then column detection
4. Add row classification (charge vs subtotal vs total) and the maths check
5. Add the multi-layout handling (side-by-side, job blocks, multi-page)
6. Build the scoring script; split invoices into a development set and a held-out set, and only check the held-out set at the end (no overfitting)
7. Add unit tests for every rule and a small FastAPI demo page

**Loom demo (3 min)**
Upload 3 invoices from different vendors → show extracted fields and line items side by side with the original → show one invoice flagged for review and why → run the scoring script and show per-field accuracy on unseen invoices.

**Why it's worth building:** Invoice and receipt extraction jobs come up constantly, and many clients now ask for "no LLM" solutions for cost and privacy. A tested, scored, rule-based extractor with real accuracy numbers on unseen documents is strong proof, and it builds on Kaf's document intelligence experience.

---