from __future__ import annotations

import math
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Box(BaseModel):
    x0: float = Field(ge=0)
    y0: float = Field(ge=0)
    x1: float = Field(ge=0)
    y1: float = Field(ge=0)

    @model_validator(mode="after")
    def valid_box(self):
        if not all(math.isfinite(v) for v in (self.x0, self.y0, self.x1, self.y1)):
            raise ValueError("Box coordinates must be finite")
        if self.x1 <= self.x0 or self.y1 <= self.y0:
            raise ValueError("Box must have positive width and height")
        return self


class Word(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    bbox: Box
    confidence: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)


class Page(BaseModel):
    number: int = Field(ge=1, le=20)
    width: float = Field(gt=0, le=20000, allow_inf_nan=False)
    height: float = Field(gt=0, le=20000, allow_inf_nan=False)
    source: Literal["digital", "ocr", "provided"] = "provided"
    words: list[Word] = Field(max_length=12000)

    @model_validator(mode="after")
    def bounds(self):
        if any(w.bbox.x1 > self.width + 2 or w.bbox.y1 > self.height + 2 for w in self.words):
            raise ValueError("Word boxes must be inside the page")
        return self


class Document(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(default="invoice.json", max_length=255)
    pages: list[Page] = Field(min_length=1, max_length=20)
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def page_order(self):
        numbers = [p.number for p in self.pages]
        if numbers != list(range(1, len(numbers) + 1)):
            raise ValueError("Pages must be numbered consecutively from 1")
        return self


class ReviewFlag(BaseModel):
    code: str
    message: str
    page: int | None = None


class LineItem(BaseModel):
    description: str
    amount: Decimal
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    page: int
    bbox: Box
    section: str | None = None
    confidence: float


class MathCheck(BaseModel):
    name: str
    status: Literal["pass", "fail", "unavailable"]
    expected: Decimal | None = None
    actual: Decimal | None = None
    difference: Decimal | None = None
    detail: str


class Extraction(BaseModel):
    filename: str
    vendor: str | None = None
    invoice_number: str | None = None
    date: str | None = None
    raw_date: str | None = None
    currency: str | None = None
    subtotal: Decimal | None = None
    tax: Decimal | None = None
    discount: Decimal | None = None
    shipping: Decimal | None = None
    total: Decimal | None = None
    line_items: list[LineItem] = Field(default_factory=list)
    checks: list[MathCheck] = Field(default_factory=list)
    flags: list[ReviewFlag] = Field(default_factory=list)
    needs_review: bool = True
    confidence: float = 0
    page_count: int = 0
    engine: str = "rules-v1"

