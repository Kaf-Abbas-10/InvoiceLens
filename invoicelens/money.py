"""Strict money parsing. Ambiguous numeric formats are left for review."""

import re
from decimal import Decimal, InvalidOperation

CURRENCIES = {"$": "USD", "£": "GBP", "€": "EUR", "USD": "USD", "GBP": "GBP", "EUR": "EUR", "PKR": "PKR", "Rs": "PKR"}
PREFIX = re.compile(r"^(?:USD|GBP|EUR|PKR|Rs\.?|\$|£|€)\s*", re.I)
SUFFIX = re.compile(r"\s*(?:USD|GBP|EUR|PKR|CR)$", re.I)


def parse_money(text: str, *, allow_integer: bool = False) -> Decimal | None:
    value = text.strip().replace("\u00a0", " ").replace("−", "-")
    negative = (value.startswith("(") and value.endswith(")")) or bool(re.search(r"\sCR$", value, re.I))
    value = value.strip("()")
    value = SUFFIX.sub("", PREFIX.sub("", value)).strip()
    if value.startswith("-"):
        negative = True
        value = value[1:].strip()
    # Accept decimal-comma and decimal-point formats, with strict group sizes.
    if re.fullmatch(r"\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}", value):
        value = value.replace(",", "")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}", value):
        value = value.replace(".", "").replace(",", ".")
    elif allow_integer and re.fullmatch(r"\d+", value):
        pass
    else:
        return None
    try:
        amount = Decimal(value)
        if len(amount.as_tuple().digits) > 14:
            return None
        return -amount if negative else amount
    except InvalidOperation:
        return None


def currency_codes(text: str) -> set[str]:
    codes = set()
    for symbol in ("$", "£", "€"):
        if symbol in text:
            codes.add(CURRENCIES[symbol])
    for code in re.findall(r"\b(?:USD|GBP|EUR|PKR|Rs)\b", text, re.I):
        codes.add("PKR" if code.lower() == "rs" else code.upper())
    return codes

