"""Vendor-independent geometry rules. Every uncertain decision remains reviewable."""
from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from statistics import mean, median

from .geometry import Row, cluster_right_edges, group_rows
from .models import Box, Document, Extraction, LineItem, MathCheck, ReviewFlag, Word
from .money import currency_codes, parse_money

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
HEADER = re.compile(r"\b(description|particulars|item|parts|labou?r|service)\b", re.I)
META = re.compile(r"\b(invoice\s*(?:no\.?|number|#)|date|due|account|phone|tel|fax|vat\s*(?:id|no)|tax\s*id|bill\s*to|ship\s*to)\b", re.I)
FOOTER = re.compile(r"^(?:page\s+\d|thank\s+you|terms\b|payment\b|bank\b|please\b|remit\b|continued\b|\d+\s+of\s+\d+)", re.I)
SECTION = re.compile(r"^(?:job|work order|repair order|section)\b", re.I)


def classify(label: str) -> str | None:
    label = label.lower().strip(" :.-")
    if re.search(r"\b(?:sub\s*total|subtotal|net total|net amount)\b", label):
        return "section_subtotal" if re.search(r"\b(job|parts|labou?r|section|page)\b", label) else "subtotal"
    if re.search(r"\b(?:brought|carried)\s+forward\b|\bbalance\s+(?:b/f|c/f)\b", label):
        return "carry"
    if re.search(r"\b(?:grand total|invoice total|total due|amount due|balance due|total payable)\b", label) or label in ("total", "total usd", "total eur", "total gbp", "total pkr"):
        return "total"
    if re.fullmatch(r"(?:(?:sales|service|total)\s+)?(?:tax|vat|gst|cgst|sgst|igst)(?:\s*\(?[\d.,]+\s*%\)?)?", label):
        return "tax"
    if re.match(r"^(?:discount|less\s*discount)\b", label):
        return "discount"
    if re.fullmatch(r"(?:shipping|freight|delivery)(?:\s+(?:charges?|fee))?", label):
        return "shipping"
    if re.match(r"^(?:amount paid|paid|deposit|previous balance|payment received)\b", label):
        return "payment"
    return None


def header(row: Row) -> bool:
    tokens = set(re.findall(r"[a-z]+", row.text.lower()))
    return bool(HEADER.search(row.text) and tokens.intersection({"amount", "total", "qty", "quantity", "price", "rate", "charges"}))


def money_words(row: Row) -> list[Word]:
    return [word for word in row.words if parse_money(word.text) is not None]


def label_before(row: Row, word: Word) -> str:
    return " ".join(w.text for w in row.words if w.bbox.x1 <= word.bbox.x0 + 1).strip()


def flag(result: Extraction, code: str, message: str, page: int | None = None):
    if not any(f.code == code and f.page == page and f.message == message for f in result.flags):
        result.flags.append(ReviewFlag(code=code, message=message, page=page))


def normalize_date(raw: str) -> str | None:
    value = raw.strip().replace(",", "")
    if re.fullmatch(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", value):
        formats = ["%Y-%m-%d", "%Y/%m/%d"]
    elif match := re.fullmatch(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})", value):
        a, b = int(match[1]), int(match[2])
        if a <= 12 and b <= 12 and a != b:
            return None
        sep = value[match.end(1)]
        formats = [f"%d{sep}%m{sep}%Y"] if a > 12 or a == b else [f"%m{sep}%d{sep}%Y"]
    else:
        formats = ["%d %B %Y", "%d %b %Y", "%B %d %Y", "%b %d %Y", "%d-%b-%Y"]
    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def metadata(rows: list[Row], result: Extraction):
    number_pattern = re.compile(r"\binvoice\s*(?:number|no\.?|#|id)\s*[:#\-]?\s*([A-Za-z0-9][A-Za-z0-9_./-]*)", re.I)
    date_pattern = re.compile(r"(?<!due )\b(?:invoice\s+date|date\s+issued|date)\s*:?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|\d{1,2}[ -][A-Za-z]+[ -]\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})", re.I)
    numbers = set()
    dates = set()
    for row in rows:
        if match := number_pattern.search(row.text):
            numbers.add(match[1].rstrip(".,"))
        if not re.match(r"^due\s+date", row.text, re.I) and (match := date_pattern.search(row.text)):
            dates.add(match[1])
    if numbers:
        result.invoice_number = sorted(numbers)[0]
        if len(numbers) > 1:
            flag(result, "conflicting_invoice_numbers", "More than one invoice number was found; check whether this is a batch.")
    if dates:
        result.raw_date = sorted(dates)[0]
        result.date = normalize_date(result.raw_date)
        if not result.date:
            flag(result, "ambiguous_date", f"Date '{result.raw_date}' is ambiguous or invalid; confirm the date format.")
        if len(dates) > 1:
            flag(result, "conflicting_dates", "Multiple invoice dates were found.")
    first_page = [r for r in rows if r.page == 1]
    for row in first_page[:10]:
        if match := re.match(r"^(?:vendor|supplier|from)\s*:\s*(.+)", row.text, re.I):
            result.vendor = match[1]
            break
    if result.vendor is None:
        for row in first_page[:6]:
            text = re.split(r"\binvoice\b", row.text, flags=re.I)[0].strip()
            if len(text) >= 3 and not META.search(text) and not re.match(r"^(?:tax invoice|invoice|receipt|bill to|ship to|customer|www\.|https?://)", text, re.I) and not money_words(row) and re.search(r"[a-zA-Z]{3}", text):
                result.vendor = text
                break
    codes = currency_codes(" ".join(r.text for r in rows))
    if len(codes) == 1:
        result.currency = codes.pop()
    elif len(codes) > 1:
        flag(result, "mixed_currency", "Multiple currency markers were found; no currency was assumed.")
    else:
        flag(result, "missing_currency", "No explicit currency marker was found.")


def regions(rows: list[Row], width: float) -> list[tuple[float, float]]:
    """Split only when two explicit description/amount header groups exist."""
    for row in rows:
        if not header(row):
            continue
        anchors = [w for w in row.words if re.fullmatch(r"description|particulars|parts|labou?r", w.text, re.I)]
        amount_headers = [w for w in row.words if re.fullmatch(r"amount|total|charges", w.text, re.I)]
        if len(anchors) >= 2 and len(amount_headers) >= 2:
            left, right = anchors[0], anchors[-1]
            if right.bbox.x0 - left.bbox.x0 > width * 0.28:
                between = [w.bbox.x1 for w in amount_headers if w.bbox.x1 < right.bbox.x0]
                if between:
                    split = (max(between) + right.bbox.x0) / 2
                    return [(0, split), (split, width + 2)]
    return [(0, width + 2)]


def check(name: str, expected: Decimal | None, actual: Decimal | None, detail: str) -> MathCheck:
    difference = (actual - expected).quantize(CENT) if expected is not None and actual is not None else None
    return MathCheck(name=name, expected=expected, actual=actual, difference=difference,
                     status="unavailable" if difference is None else "pass" if abs(difference) <= CENT else "fail", detail=detail)


def extract(document: Document) -> Extraction:
    result = Extraction(filename=document.filename, page_count=len(document.pages))
    all_rows = [row for page in document.pages for row in group_rows(page)]
    metadata(all_rows, result)
    for warning in document.warnings:
        flag(result, "ingestion_warning", warning)
    summaries: dict[str, list[tuple[Decimal, int, float]]] = {}
    section_checks: list[MathCheck] = []
    last_section: dict[int, str | None] = {}
    for page in document.pages:
        rows = [r for r in all_rows if r.page == page.number]
        if not rows:
            flag(result, "empty_page", "No readable words were found on this page.", page.number)
            continue
        for region_index, (left, right) in enumerate(regions(rows, page.width)):
            region_rows = [Row([w for w in r.words if left <= w.bbox.x0 < right], r.page) for r in rows]
            region_rows = [r for r in region_rows if r.words]
            headers = [r for r in region_rows if header(r)]
            table_top = headers[0].bbox.y1 if headers else 0
            candidates: list[Word] = []
            for row in region_rows:
                nums = money_words(row)
                if not nums or row.bbox.y0 < table_top or META.search(row.text) or FOOTER.search(row.text):
                    continue
                if classify(label_before(row, nums[-1])) is None:
                    candidates.extend(nums)
            clusters = cluster_right_edges(candidates, max(5, page.width * 0.012))
            # The amount column is the rightmost aligned numeric cluster. It may
            # contain just one charge; quantity/rate columns lie to its left.
            amount_x = median([w.bbox.x1 for w in clusters[-1]]) if clusters else None
            tolerance = max(7, page.width * 0.018)
            active = False
            closed = False
            previous: LineItem | None = None
            section = last_section.get(region_index)
            section_amounts: list[Decimal] = []
            for row in region_rows:
                nums = money_words(row)
                if header(row):
                    active, closed, previous = True, False, None
                    continue
                if nums:
                    last = nums[-1]
                    label = label_before(row, last)
                    kind = classify(label)
                    if kind:
                        amount = parse_money(last.text)
                        assert amount is not None
                        if kind == "section_subtotal":
                            if section_amounts:
                                section_checks.append(check("section_subtotal", sum(section_amounts, ZERO), amount, f"{label} (page {page.number})"))
                            section_amounts = []
                            previous = None
                        elif kind == "carry":
                            previous = None
                        elif kind == "payment":
                            flag(result, "payment_adjustment", "Payments or previous balances require manual reconciliation.", page.number)
                            previous = None
                        else:
                            summaries.setdefault(kind, []).append((amount, page.number, row.bbox.y0))
                            active, closed, previous = False, True, None
                        continue
                if SECTION.search(row.text) and not nums:
                    section = row.text
                    last_section[region_index] = section
                    active, closed, previous = True, False, None
                    section_amounts = []
                    continue
                if row.bbox.y0 < table_top or FOOTER.search(row.text) or META.search(row.text):
                    previous = None
                    continue
                if nums and not closed and amount_x is not None:
                    eligible = [w for w in nums if abs(w.bbox.x1 - amount_x) <= tolerance]
                    if not eligible:
                        # A monetary row outside the selected amount column must
                        # never silently disappear from the extraction.
                        flag(result, "unaligned_amount", f"Check unaligned monetary row: {row.text}", page.number)
                        previous = None
                        continue
                    amount_word = eligible[-1]
                    before = [w for w in row.words if w.bbox.x1 <= amount_word.bbox.x0 + 1]
                    amount = parse_money(amount_word.text)
                    assert amount is not None
                    numeric_cells = [(w, parse_money(w.text, allow_integer=True)) for w in before if parse_money(w.text, allow_integer=True) is not None]
                    quantity = unit_price = None
                    table_cells: list[Word] = []
                    # Only interpret quantity/rate when headings explicitly name
                    # those columns. Part numbers must not become quantities.
                    preceding_headers = [h for h in headers if h.bbox.y0 < row.bbox.y0]
                    if preceding_headers and numeric_cells:
                        current_header = preceding_headers[-1]
                        for cell, value in numeric_cells:
                            overlapping = [w.text.lower() for w in current_header.words if w.bbox.x0 - tolerance <= (cell.bbox.x0 + cell.bbox.x1) / 2 <= w.bbox.x1 + tolerance]
                            if set(overlapping).intersection({"qty", "quantity", "hours"}):
                                quantity = value
                                table_cells.append(cell)
                            if set(overlapping).intersection({"rate", "price"}):
                                unit_price = value
                                table_cells.append(cell)
                    description_words = [w for w in before if w not in table_cells and not re.fullmatch(r"[$£€]|USD|GBP|EUR|PKR", w.text, re.I)]
                    # Without explicit headers, decimals preceding the amount
                    # are likely rates. Flag the unresolved column semantics.
                    if not preceding_headers and any(parse_money(w.text) is not None for w in before):
                        flag(result, "unknown_numeric_columns", f"Unlabelled numeric columns in row: {row.text}", page.number)
                    description = " ".join(w.text for w in description_words).strip()
                    if not description or not re.search(r"[^\W\d_]", description, re.UNICODE):
                        flag(result, "unlabelled_amount", f"An amount has no usable description: {row.text}", page.number)
                        continue
                    confidence = round(min(w.confidence for w in row.words), 3)
                    item = LineItem(description=description, amount=amount, quantity=quantity, unit_price=unit_price,
                                    page=page.number, bbox=row.bbox, section=section, confidence=confidence)
                    result.line_items.append(item)
                    section_amounts.append(amount)
                    if confidence < 0.80:
                        flag(result, "low_ocr_confidence", f"Low OCR confidence on '{description}'.", page.number)
                    if quantity is not None and unit_price is not None:
                        result.checks.append(check("quantity_times_price", (quantity * unit_price).quantize(CENT), amount, description))
                    previous, active = item, True
                elif not nums and active and previous and not closed:
                    # Attach only nearby, left-aligned continuation text; a new
                    # section, footer or metadata line never becomes a description.
                    gap = row.bbox.y0 - previous.bbox.y1
                    height = row.bbox.y1 - row.bbox.y0
                    if 0 <= gap <= height * 1.5 and abs(row.bbox.x0 - previous.bbox.x0) <= tolerance * 2:
                        previous.description += " " + row.text
                        previous.bbox = Box(x0=min(previous.bbox.x0, row.bbox.x0), y0=previous.bbox.y0,
                                            x1=max(previous.bbox.x1, row.bbox.x1), y1=row.bbox.y1)
                        previous.confidence = min(previous.confidence, round(min(w.confidence for w in row.words), 3))
                        if previous.confidence < .80:
                            flag(result, "low_ocr_confidence", "Low OCR confidence in a continued description.", page.number)
                    else:
                        previous = None
                elif nums and closed and classify(label_before(row, nums[-1])) is None and not FOOTER.search(row.text):
                    flag(result, "amount_after_totals", f"A monetary row follows the totals: {row.text}", page.number)
    # Last-page global summaries win. Conflicting duplicates on that page are
    # surfaced; local job subtotals are kept out of global reconciliation.
    for kind, values in summaries.items():
        last_page = max(v[1] for v in values)
        last_values = [v for v in values if v[1] == last_page]
        if kind == "tax":
            # Distinct tax components can add up, but a labelled 'total tax'
            # alongside components is not safely distinguishable here.
            if len(last_values) > 1:
                flag(result, "multiple_tax_rows", "Multiple tax amounts were added; verify components are not duplicated.", last_page)
            setattr(result, kind, sum((v[0] for v in last_values), ZERO))
        elif kind in ("shipping", "discount"):
            setattr(result, kind, sum((abs(v[0]) for v in last_values), ZERO))
        else:
            setattr(result, kind, sorted(last_values, key=lambda v: v[2])[-1][0])
            if len({v[0] for v in last_values}) > 1:
                flag(result, "conflicting_totals", f"Different {kind} values were found on the final summary page.", last_page)
    result.line_items.sort(key=lambda item: (item.page, item.bbox.y0, item.bbox.x0))
    line_sum = sum((item.amount for item in result.line_items), ZERO)
    result.checks.extend(section_checks)
    result.checks.append(check("lines_match_subtotal", line_sum if result.line_items else None, result.subtotal,
                               "Sum of extracted line amounts equals the printed subtotal."))
    expected_total = None
    if result.subtotal is not None:
        expected_total = result.subtotal + (result.tax or ZERO) + (result.shipping or ZERO) - (result.discount or ZERO)
    result.checks.append(check("total_reconciles", expected_total, result.total,
                               "Subtotal + printed tax + shipping - discount equals the total. Missing adjustments contribute zero."))
    for item_check in result.checks:
        if item_check.status == "fail":
            flag(result, "math_mismatch", f"{item_check.name}: expected {item_check.expected}, found {item_check.actual} (difference {item_check.difference}).")
    for field in ("vendor", "invoice_number", "date", "subtotal", "total"):
        if getattr(result, field) is None:
            flag(result, f"missing_{field}", f"The {field.replace('_', ' ')} could not be determined.")
    if not result.line_items:
        flag(result, "no_line_items", "No charge rows could be extracted.")
    # Metadata/summary OCR matters even when line items are legible.
    if any(w.confidence < .8 for page in document.pages for w in page.words) and not any(f.code == "low_ocr_confidence" for f in result.flags):
        flag(result, "uncertain_ocr", "Some OCR words have confidence below 80%; inspect metadata and totals in the source.")
    result.needs_review = bool(result.flags)
    word_confidence = mean(w.confidence for p in document.pages for w in p.words) if any(p.words for p in document.pages) else 0
    result.confidence = round(max(0, min(1, word_confidence - .07 * len(result.flags))), 3)
    return result

