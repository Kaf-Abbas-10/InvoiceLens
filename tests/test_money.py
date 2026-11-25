from decimal import Decimal

import pytest

from invoicelens.money import currency_codes, parse_money


@pytest.mark.parametrize("text,expected", [
    ("123.45", "123.45"), ("$1,234.56", "1234.56"), ("£50.00", "50.00"),
    ("EUR 1.234,56", "1234.56"), ("45,90", "45.90"), ("(25.00)", "-25.00"),
    ("-15.75", "-15.75"), ("USD -9.50", "-9.50"), ("12.00 CR", "-12.00"),
    ("Rs. 75.00", "75.00"), ("0.00", "0.00"), ("999,999.99", "999999.99"),
])
def test_money_formats(text, expected):
    assert parse_money(text) == Decimal(expected)


@pytest.mark.parametrize("text", ["", "1234", "12,345", "12.345", "1,23.45", "NaN", "inf", "1e3", "O.00", "10%", "2026-11-24", "1.2.3", "-", "999999999999999.00"])
def test_unsafe_or_ambiguous_money_is_rejected(text):
    assert parse_money(text) is None


def test_quantity_integers_are_opt_in():
    assert parse_money("3") is None
    assert parse_money("3", allow_integer=True) == 3


def test_currency_boundaries():
    assert currency_codes("$10.00 USD") == {"USD"}
    assert currency_codes("EUR 10,00 and GBP 20.00") == {"EUR", "GBP"}
    assert currency_codes("Rs 20.00") == {"PKR"}
    assert currency_codes("builders supplies") == set()

