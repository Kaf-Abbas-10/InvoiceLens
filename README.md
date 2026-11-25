# InvoiceLens

**A local invoice extraction engine with a review workspace. No LLMs, vendor templates, or paid extraction APIs.**

InvoiceLens reads words and bounding boxes, groups them into rows, identifies amount columns by alignment, and extracts invoice metadata and charge lines. It checks the arithmetic and explains what needs human review. The backend is Python 3.11+, FastAPI, PyMuPDF, NumPy, and optional local Tesseract; the frontend is plain HTML, CSS, and JavaScript with no build step or external assets.

This is a working portfolio MVP. Eight synthetic layout fixtures and an automated test suite are included. **A real, independently labelled 40–60 document corpus and an unseen accuracy benchmark are still needed.** Synthetic fixture results are not real-world accuracy claims.

## Start on this Windows workspace

The project environment has already been created and the application dependencies installed:

```powershell
.\.venv\Scripts\invoicelens.exe serve --port 8011
```

Open **http://127.0.0.1:8011**. Local API documentation is at **http://127.0.0.1:8011/docs**. Port 8011 is used here because 8000 was already occupied on this machine.

Try **Fleet service**, **Parts & labour**, and **Needs review** in the workspace. The last example intentionally has a $10 total mismatch and a low-confidence amount. Select a charge to highlight its page coordinates, switch to the original PDF, and export JSON or CSV. Additional examples cover wrapped descriptions, job subtotals, multi-page tables, credits, and missing headers.

Uploads and results are not saved by the server. Browser history is in memory for the current session, limited to 12 entries, and clears on refresh. Multipart uploads may temporarily spool to the operating system's temporary directory. The page makes no requests to remote fonts, analytics, or extraction services.

## Fresh installation

With [uv](https://docs.astral.sh/uv/):

```powershell
uv venv --python 3.11 .venv
uv pip install --python .venv\Scripts\python.exe -e ".[dev]"
.\.venv\Scripts\invoicelens.exe serve --port 8011
```

Or with an existing Python 3.11+ installation:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -e '.[dev]'
invoicelens serve --port 8011
```

The default host is `127.0.0.1`. This application is intended for a local demo. It has no authentication or durable storage.

### OCR for scanned PDFs and images

The Python `pytesseract` package is a wrapper; the Tesseract executable must be installed separately. See the [Tesseract installation guide](https://tesseract-ocr.github.io/tessdoc/Installation.html) for platform-specific packages and Windows installer options.

On Windows, install Tesseract with English language data and either add its directory to `PATH` or set:

```powershell
$env:TESSERACT_CMD = 'C:\Program Files\Tesseract-OCR\tesseract.exe'
.\.venv\Scripts\invoicelens.exe serve --port 8011
```

On Debian/Ubuntu: `sudo apt-get install tesseract-ocr`. On macOS: `brew install tesseract`.

`GET /api/health` reports whether an executable was found. Digital PDFs and normalized word JSON do not require OCR. Images and textless PDF pages use local Tesseract with a 30-second timeout per page. Recognition quality depends on scan resolution, orientation, and language; the current default is English.

### Docker with OCR included

```bash
docker build -t invoicelens .
docker run --rm -p 127.0.0.1:8011:8000 invoicelens
```

The container runs as a non-root user. Visit http://127.0.0.1:8011. Docker is an alternative installation path; the image has not been built as part of the local Python checks.

## Command-line tools

After activating the environment:

```bash
# Extract metadata, lines, checks, and flags.
invoicelens extract invoice.pdf --output reports/invoice.json
invoicelens extract invoice.pdf --format csv --output reports/lines.csv

# Cache normalized words and page geometry for inspection or annotation.
invoicelens words invoice.pdf --output data/private/invoice.words.json

# Generate PDF/word JSON versions of the synthetic examples.
invoicelens samples --output data/samples

# Evaluate the included synthetic DEVELOPMENT fixtures.
invoicelens score data/synthetic/manifest.json --split dev

# Evaluate your independently labelled corpus.
invoicelens score data/my-manifest.json --split dev --output reports/dev.json
invoicelens score data/my-manifest.json --split held-out --output reports/held-out.json
```

CSV exports contain line items. JSON also includes all metadata, totals, source boxes, reconciliation results, and review reasons. Decimal amounts are serialized as strings to avoid binary floating-point rounding.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Local engine status, OCR availability, limits |
| `POST /api/extract` | Multipart `file` upload → `{document, extraction, synthetic}` |
| `GET /api/samples` | List the eight synthetic examples |
| `GET /api/samples/{id}` | Run extraction on a synthetic example |
| `GET /api/samples/{id}/pdf` | Download its synthetic PDF |
| `GET /docs` | Interactive API documentation |

```bash
curl -F "file=@invoice.pdf" http://127.0.0.1:8011/api/extract
```

Supported input: PDF, PNG, JPEG, TIFF (including multiple frames), and normalized word JSON. Limits: 20 MB per file, 20 pages/frames, 24 megapixels per image, 12,000 words per page. Extraction is limited to two concurrent jobs per process. File extension selects the decoder; malformed content is rejected by that decoder. Password-protected PDFs are rejected. Errors use an actionable `detail` string; unavailable OCR returns HTTP 503.

### Normalized word JSON

Coordinates use each page's own units, measured from the top-left. PDF words use points; OCR words use pixels. Confidence is 0–1. Pages must be numbered consecutively from 1 and boxes must fit inside the page.

```json
{
  "filename": "example.json",
  "pages": [
    {
      "number": 1,
      "width": 600,
      "height": 780,
      "source": "provided",
      "words": [
        {
          "text": "Inspection",
          "bbox": {"x0": 40, "y0": 200, "x1": 105, "y1": 212},
          "confidence": 0.97
        },
        {
          "text": "100.00",
          "bbox": {"x0": 515, "y0": 200, "x1": 555, "y1": 212},
          "confidence": 0.99
        }
      ]
    }
  ]
}
```

You can adapt output from another OCR engine to this schema without changing the extraction rules.

## Extraction rules

1. **Ingest.** PyMuPDF reads digital PDF words and coordinates. Pages with fewer than three text words are rasterized for Tesseract. Image frames also use Tesseract. Sparse text layers with embedded images produce a warning.
2. **Group rows.** Sort words by vertical center and cluster within a tolerance based on the median glyph height. Sort each row left to right.
3. **Find regions and columns.** Explicit repeated parts/labour headers can separate side-by-side regions. Within each region, cluster monetary tokens by their right edges and choose the rightmost charge column. A header is helpful but not required for amount alignment.
4. **Classify.** Explicit summary labels identify subtotals, tax, total, shipping, discounts, carry rows, and payments. Job labels establish section boundaries. Global summary amounts are never invented from the line sum.
5. **Attach descriptions.** Keep the description and amount from the same region and row; attach nearby left-aligned continuation text below the charge. Quantity and rate are interpreted only with matching column headings. Preserve part numbers in descriptions.
6. **Reconcile.** Use `Decimal` for quantity × rate, section subtotals, charge sum versus printed subtotal, and subtotal + printed tax + shipping − discount versus printed total. Tolerance is one cent. Missing adjustments contribute zero; missing subtotal or total makes a check unavailable and triggers review.
7. **Review.** Flag missing required fields/currency, conflicting metadata/totals, uncertain OCR, mixed currencies, unaligned money, unexplained rows after totals, payment adjustments, and maths failures. Confidence is a conservative rule heuristic, **not** a calibrated probability.

Source boxes and pages survive extraction. The UI's **Word map** is a reconstruction of word geometry, not a raster scan. **Original** shows the uploaded PDF/PNG/JPEG or the synthetic sample PDF when available. TIFF originals and input word JSON use the word map.

### Current boundaries

- Rules currently target English labels and Latin-script vendor headers. Vendor-name selection is a top-of-document heuristic.
- Explicit table headers are needed to separate side-by-side tables reliably. Arbitrary nested tables and irregular overlapping layouts need more rules and real examples.
- Continued descriptions below a charge are supported; descriptions that only precede an amount-only row are flagged rather than guessed.
- Monetary tokens currently require two decimal places. Both common decimal-point and decimal-comma formats are accepted. Split currency glyphs are accepted, but split digits or OCR-confused digits are not repaired silently.
- Numeric dates such as `03/04/2026` remain unresolved and require review. Unambiguous numeric dates, ISO dates, and common English month names are supported.
- Multiple printed tax rows are summed and always flagged, because a combined tax total could duplicate component taxes.
- Job-subtotal checks currently operate within a page. Cross-page charge tables work, but a single job spanning multiple pages needs review and additional section-reconciliation rules.
- A mathematically balanced invoice can still have an incorrect vendor, date, description, or a missed charge offset by another error. Human inspection and unseen evaluation remain necessary.
- The local machine's Tesseract binary is not bundled. OCR conversion is covered by mocked tests; a real-engine smoke test is provided and runs when Tesseract is available.

## Evaluation without overfitting

The included eight documents are **synthetic development fixtures**, with manually authored expected labels. Their truth files are independent of the extractor. All are deliberately marked `dev`: no held-out synthetic result is presented as unseen evidence. The generator is `scripts/build_synthetic_dataset.py`.

For a defensible portfolio benchmark:

1. Collect 40–60 legally usable real invoices from varied vendors and layouts. Keep source URLs, licence/permission information, and document hashes. Redact sensitive information before committing anything. `data/private/` and `reports/` are ignored.
2. Label metadata, totals, and **every** charge independently. Use the truth schema in `data/synthetic/*.truth.json`. Explicit `null` values are scored; omitted metadata fields are excluded from scoring. `line_items` is required.
3. Group by vendor/layout family before creating the split; keep near-duplicates in one split. Start with roughly 70% development and 30% held-out documents. Freeze and record the split before changing rules.
4. Use `data/manifest.example.json` as a starting point. The evaluator rejects repeated IDs and identical input paths, but it cannot detect visually similar documents or enforce your experiment discipline.
5. Iterate only on `dev`. Freeze the engine, record the commit/hash, then run `--split held-out` once. Retuning after seeing failures turns that split into development data and calls for a fresh test set.

The report includes per-field correct/total/accuracy and exact normalized **description + amount** line-item precision, recall, and F1. Line matching is order-independent and duplicate-aware. It is deliberately strict; it does not measure OCR character accuracy, box overlap, quantity/rate accuracy, or field-level confidence calibration. Null-field correctness should be interpreted alongside support counts. Extraction errors fail the scoring run rather than silently dropping difficult documents.

[CORD](https://github.com/clovaai/cord) is a possible starting point for receipt research and has its own schema, language, and usage conditions. Receipt datasets need adaptation and should not be treated as substitutes for representative supplier and repair invoices.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Tests cover money parsing, row jitter and scaling, line extraction, description wrapping, side-by-side tables, job blocks, page continuation, negative credits, quantity/rate checks, ambiguous dates, missing/conflicting totals, upload limits, corrupt files, OCR conversion and missing-engine errors, real digital PDF round trips, the API, CLI, and scoring. CI runs Python 3.11 with Tesseract installed.

## Project map

```text
invoicelens/
  models.py       Validated words, page boxes, line items, and results
  ingest.py       PDF text and local OCR adapters
  money.py        Strict currency and decimal parsing
  geometry.py     Row grouping and right-edge clustering
  engine.py       Metadata, table rules, classification, reconciliation
  scoring.py      Ground-truth evaluation and per-field metrics
  cli.py          Serve, extract, words, samples, and score commands
  api.py          FastAPI application and upload handling
  samples.py      Synthetic geometry fixtures and PDF generation
  static/         Responsive review workspace; no frontend build
data/synthetic/   Eight labelled development fixtures and manifest
tests/            Unit and integration tests
scripts/          Dataset generator and optional browser smoke check
```

Technical references: [PyMuPDF word extraction](https://pymupdf.readthedocs.io/en/latest/recipes-text.html), [FastAPI file uploads](https://fastapi.tiangolo.com/tutorial/request-files/), and [Tesseract documentation](https://tesseract-ocr.github.io/tessdoc/).

