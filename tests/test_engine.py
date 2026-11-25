from decimal import Decimal

import pytest

from invoicelens.engine import classify, extract, normalize_date
from invoicelens.geometry import group_rows
from invoicelens.models import Box, Document, Page
from invoicelens.samples import SAMPLE_INFO, base, charge, document, heading, make_sample, summary, text_line, word


@pytest.mark.parametrize("sample,count,total", [
    ("fleet-service", 3, "423.50"), ("side-by-side", 4, "352.00"),
    ("multiline", 3, "423.50"), ("job-blocks", 3, "220.00"),
    ("multi-page", 3, "330.00"), ("credit", 2, "137.50"), ("no-header", 2, "132.00"),
])
def test_layout_rules(sample, count, total):
    result = extract(make_sample(sample))
    assert len(result.line_items) == count
    assert result.total == Decimal(total)
    assert not result.needs_review, result.flags
    assert all(check.status == "pass" for check in result.checks)


def test_review_reasons_are_actionable():
    result = extract(make_sample("review-required"))
    assert result.needs_review
    assert {f.code for f in result.flags} >= {"math_mismatch", "low_ocr_confidence"}
    total_check = next(c for c in result.checks if c.name == "total_reconciles")
    assert total_check.difference == Decimal("10.00")


def test_uncertain_metadata_is_flagged_even_with_clean_charge_rows():
    doc = make_sample("fleet-service")
    next(w for w in doc.pages[0].words if w.text == "NFS-2048").confidence = .65
    assert any(f.code == "uncertain_ocr" for f in extract(doc).flags)


def test_uncertain_continuation_word_is_not_averaged_away():
    doc = make_sample("multiline")
    next(w for w in doc.pages[0].words if w.text == "diagnostic").confidence = .6
    result = extract(doc)
    assert result.line_items[-1].confidence == .6
    assert any(f.code == "low_ocr_confidence" for f in result.flags)


def test_wrapped_description_keeps_source_box():
    item = extract(make_sample("multiline")).line_items[-1]
    assert item.description == "Workshop labour including diagnostic scan"
    assert item.bbox.y0 == 285
    assert item.bbox.y1 == 314


def test_side_by_side_rows_never_cross_columns():
    result = extract(make_sample("side-by-side"))
    assert [i.description for i in result.line_items] == ["Air filter", "Diagnostics", "Belt kit", "Installation"]
    assert [i.amount for i in result.line_items] == [Decimal("45"), Decimal("80"), Decimal("75"), Decimal("120")]


def test_quantity_and_unit_price_use_headers():
    result = extract(make_sample("fleet-service"))
    assert result.line_items[0].quantity == 2
    assert result.line_items[0].unit_price == Decimal("60.00")
    assert sum(c.name == "quantity_times_price" for c in result.checks) == 3


def test_quantity_mismatch_is_flagged():
    doc = make_sample("fleet-service")
    next(w for w in doc.pages[0].words if w.text == "60.00").text = "50.00"
    result = extract(doc)
    assert result.needs_review
    assert any(c.name == "quantity_times_price" and c.status == "fail" for c in result.checks)


def test_part_number_is_preserved_in_description():
    words = base()
    heading(words)
    charge(words, "Filter 12345", "25.00", 210)
    summary(words, "25.00", "2.50", "27.50")
    result = extract(document("part-number", [words]))
    assert result.line_items[0].description == "Filter 12345"
    assert result.line_items[0].quantity is None


def test_section_subtotals_are_not_charge_rows():
    result = extract(make_sample("job-blocks"))
    assert [i.section for i in result.line_items] == ["Job A - Brake service"] * 2 + ["Job B - Tyre service"]
    assert sum(c.name == "section_subtotal" for c in result.checks) == 2


def test_section_subtotal_mismatch_is_flagged():
    doc = make_sample("job-blocks")
    next(w for w in doc.pages[0].words if w.text == "160.00").text = "161.00"
    assert any(c.name == "section_subtotal" and c.status == "fail" for c in extract(doc).checks)


def test_repeated_page_headers_and_carry_are_not_items():
    result = extract(make_sample("multi-page"))
    assert [i.page for i in result.line_items] == [1, 2, 2]
    assert all("forward" not in i.description.lower() for i in result.line_items)


def test_tax_preparation_is_a_charge_not_tax_summary():
    assert classify("Tax preparation") is None
    assert classify("Tax 10%") == "tax"
    assert classify("Total tax") == "tax"


@pytest.mark.parametrize("raw,expected", [
    ("2026-11-24", "2026-11-24"), ("24/11/2026", "2026-11-24"), ("11/24/2026", "2026-11-24"),
    ("24 November 2026", "2026-11-24"), ("Nov 24, 2026", "2026-11-24"),
    ("03/04/2026", None), ("2026-02-30", None), ("99/13/2026", None),
])
def test_date_normalization(raw, expected):
    assert normalize_date(raw) == expected


def test_ambiguous_date_never_silently_assumes_locale():
    words = base(date="03/04/2026")
    heading(words)
    charge(words, "Inspection", "10.00", 210)
    summary(words, "10.00", "1.00", "11.00")
    result = extract(document("date", [words]))
    assert result.date is None
    assert result.raw_date == "03/04/2026"
    assert any(f.code == "ambiguous_date" for f in result.flags)


def test_subtotal_is_never_backfilled_from_sum():
    doc = make_sample("fleet-service")
    doc.pages[0].words = [w for w in doc.pages[0].words if w.bbox.y0 != 430]
    result = extract(doc)
    assert result.subtotal is None
    assert result.needs_review
    assert next(c for c in result.checks if c.name == "lines_match_subtotal").status == "unavailable"


def test_empty_page_is_reviewable():
    result = extract(Document(pages=[Page(number=1, width=600, height=780, words=[])]))
    assert result.needs_review and result.confidence == 0
    assert any(f.code == "empty_page" for f in result.flags)


def test_unaligned_amount_is_not_silently_dropped():
    doc = make_sample("fleet-service")
    amount = next(w for w in doc.pages[0].words if w.text == "85.00" and w.bbox.x1 == 555)
    amount.bbox = Box(x0=450, y0=245, x1=490, y1=257)
    result = extract(doc)
    assert result.needs_review
    assert any(f.code == "unaligned_amount" for f in result.flags)


def test_amount_after_total_is_flagged():
    doc = make_sample("fleet-service")
    charge(doc.pages[0].words, "Unexpected fee", "20.00", 550)
    assert any(f.code == "amount_after_totals" for f in extract(doc).flags)


def test_duplicate_totals_conflict_is_visible():
    doc = make_sample("fleet-service")
    doc.pages[0].words += text_line("Total", 385, 530) + [word("400.00", 0, 530, right=555)]
    assert any(f.code == "conflicting_totals" for f in extract(doc).flags)


def test_missing_currency_is_flagged():
    doc = make_sample("fleet-service")
    doc.pages[0].words = [w for w in doc.pages[0].words if w.text != "USD"]
    result = extract(doc)
    assert result.currency is None
    assert any(f.code == "missing_currency" for f in result.flags)


def test_mixed_currencies_are_flagged():
    doc = make_sample("fleet-service")
    doc.pages[0].words += text_line("Also EUR", 40, 600)
    result = extract(doc)
    assert result.currency is None
    assert any(f.code == "mixed_currency" for f in result.flags)


def test_discount_and_shipping_reconcile():
    words = base()
    heading(words)
    charge(words, "Inspection", "100.00", 210)
    for label, amount, y in [("Subtotal", "100.00", 400), ("Tax", "10.00", 430), ("Shipping", "5.00", 460), ("Discount", "15.00", 490), ("Total", "100.00", 520)]:
        words += text_line(label, 385, y) + [word(amount, 0, y, right=555)]
    result = extract(document("adjustments", [words]))
    assert result.shipping == 5 and result.discount == 15
    assert not result.needs_review


def test_row_clustering_handles_y_jitter_and_unsorted_words():
    doc = make_sample("fleet-service")
    words = doc.pages[0].words
    for i, w in enumerate(words):
        shift = (i % 3) - 1
        w.bbox.y0 += shift
        w.bbox.y1 += shift
    doc.pages[0].words = list(reversed(words))
    result = extract(doc)
    assert len(result.line_items) == 3
    assert not result.needs_review


def test_scaling_coordinates_preserves_extraction():
    doc = make_sample("side-by-side")
    for page in doc.pages:
        page.width *= 2.5
        page.height *= 2.5
        for w in page.words:
            w.bbox = Box(**{key: value * 2.5 for key, value in w.bbox.model_dump().items()})
    result = extract(doc)
    assert len(result.line_items) == 4 and not result.needs_review


def test_deterministic_results():
    for key in SAMPLE_INFO:
        doc = make_sample(key)
        before = doc.model_dump_json()
        assert extract(doc).model_dump_json() == extract(doc).model_dump_json()
        assert doc.model_dump_json() == before

