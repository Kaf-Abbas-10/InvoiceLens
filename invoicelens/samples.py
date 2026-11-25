"""Hand-authored, synthetic layout fixtures, never real-world benchmark data."""
from .models import Box, Document, Page, Word


def word(text, x, y, *, right=None, confidence=1):
    width = max(7, len(text) * 6)
    return Word(text=text, bbox=Box(x0=x if right is None else right - width, y0=y,
                                  x1=x + width if right is None else right, y1=y + 12), confidence=confidence)


def text_line(text, x, y):
    output = []
    for token in text.split():
        output.append(word(token, x, y))
        x += len(token) * 6 + 5
    return output


def base(vendor="Northstar Fleet Services", number="NFS-2048", date="24 November 2026"):
    words = text_line(vendor, 40, 35)
    words += text_line(f"Invoice No: {number}", 40, 78)
    words += text_line(f"Invoice Date: {date}", 40, 100)
    words += text_line("Currency: USD", 40, 122)
    return words


def heading(words, y=170, left=40, right=555, name="Description", details=False):
    words.extend(text_line(name, left, y))
    if details:
        words.append(word("Qty", 345, y))
        words.append(word("Price", 425, y))
    words.append(word("Amount", 0, y, right=right))


def charge(words, description, amount, y, *, x=40, right=555, qty=None, price=None, confidence=1):
    words.extend(text_line(description, x, y))
    if qty is not None:
        words.append(word(str(qty), 0, y, right=365))
    if price is not None:
        words.append(word(price, 0, y, right=455))
    words.append(word(amount, 0, y, right=right, confidence=confidence))


def summary(words, subtotal, tax, total, y=430):
    for label, value in (("Subtotal", subtotal), ("Tax 10%", tax), ("Total", total)):
        words.extend(text_line(label, 385, y))
        words.append(word(value, 0, y, right=555))
        y += 26


def document(name, pages):
    return Document(filename=f"{name}.json", pages=[Page(number=i + 1, width=600, height=780, words=words) for i, words in enumerate(pages)])


def make_sample(sample_id: str) -> Document:
    if sample_id not in SAMPLE_INFO:
        raise KeyError(sample_id)
    w = base()
    if sample_id in ("fleet-service", "review-required", "multiline"):
        heading(w, details=True)
        charge(w, "Engine oil & filter", "120.00", 205, qty=2, price="60.00")
        charge(w, "Brake inspection", "85.00", 245, qty=1, price="85.00")
        charge(w, "Workshop labour", "180.00", 285, qty=2, price="90.00", confidence=.57 if sample_id == "review-required" else 1)
        if sample_id == "multiline":
            w += text_line("including diagnostic scan", 40, 302)
        summary(w, "385.00", "38.50", "433.50" if sample_id == "review-required" else "423.50")
    elif sample_id == "side-by-side":
        w = base("Atlas Repair Works", "AR-917")
        heading(w, left=40, right=280, name="Parts")
        heading(w, left=330, right=555, name="Labour")
        charge(w, "Air filter", "45.00", 205, right=280)
        charge(w, "Diagnostics", "80.00", 205, x=330)
        charge(w, "Belt kit", "75.00", 240, right=280)
        charge(w, "Installation", "120.00", 240, x=330)
        summary(w, "320.00", "32.00", "352.00")
    elif sample_id == "job-blocks":
        heading(w)
        w += text_line("Job A - Brake service", 40, 192)
        charge(w, "Brake pads", "100.00", 218)
        charge(w, "Fitting", "60.00", 244)
        w += text_line("Job subtotal", 390, 275)
        w.append(word("160.00", 0, 275, right=555))
        w += text_line("Job B - Tyre service", 40, 308)
        charge(w, "Tyre rotation", "40.00", 335)
        w += text_line("Job subtotal", 390, 366)
        w.append(word("40.00", 0, 366, right=555))
        summary(w, "200.00", "20.00", "220.00")
    elif sample_id == "multi-page":
        heading(w)
        charge(w, "Annual inspection", "200.00", 210)
        w += text_line("Carried forward", 385, 690)
        w.append(word("200.00", 0, 690, right=555))
        second = text_line("Northstar Fleet Services", 40, 35)
        heading(second, y=90)
        charge(second, "Replacement hoses", "75.00", 130)
        charge(second, "Road test", "25.00", 165)
        summary(second, "300.00", "30.00", "330.00")
        return document(sample_id, [w, second])
    elif sample_id == "credit":
        heading(w)
        charge(w, "Replacement pump", "150.00", 205)
        charge(w, "Returned core credit", "(25.00)", 245)
        summary(w, "125.00", "12.50", "137.50")
    elif sample_id == "no-header":
        charge(w, "Safety inspection", "100.00", 205)
        charge(w, "Fluid top-up", "20.00", 245)
        summary(w, "120.00", "12.00", "132.00")
    return document(sample_id, [w])


SAMPLE_INFO = {
    "fleet-service": {"title": "Fleet service", "description": "Quantity × price and clean totals", "vendor": "Northstar Fleet Services"},
    "side-by-side": {"title": "Parts & labour", "description": "Two tables on one page", "vendor": "Atlas Repair Works"},
    "review-required": {"title": "Needs a closer look", "description": "Low OCR confidence and a $10 discrepancy", "vendor": "Northstar Fleet Services"},
    "multiline": {"title": "Wrapped description", "description": "A charge continued onto a second row", "vendor": "Northstar Fleet Services"},
    "job-blocks": {"title": "Multiple jobs", "description": "Job-level and invoice-level subtotals", "vendor": "Northstar Fleet Services"},
    "multi-page": {"title": "Two-page invoice", "description": "Repeated headers and a carried balance", "vendor": "Northstar Fleet Services"},
    "credit": {"title": "Core return credit", "description": "Negative charge in parentheses", "vendor": "Northstar Fleet Services"},
    "no-header": {"title": "Missing table header", "description": "Find amount columns using alignment", "vendor": "Northstar Fleet Services"},
}


def sample_pdf(doc: Document) -> bytes:
    import pymupdf

    with pymupdf.open() as pdf:
        for source in doc.pages:
            page = pdf.new_page(width=source.width, height=source.height)
            for token in source.words:
                # Courier is 6 points per glyph at size 10, matching fixture boxes.
                safe = token.text.replace("×", "x")
                page.insert_text((token.bbox.x0, token.bbox.y0 + 10), safe, fontname="cour", fontsize=10)
        return pdf.tobytes()

