"""In-memory digital PDF extraction and local Tesseract OCR."""
from __future__ import annotations

import io
import json
import os
import shutil
import warnings
from pathlib import Path

import pymupdf
import pytesseract
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError

from .models import Box, Document, Page, Word

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 20
MAX_PIXELS = 24_000_000
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".json"}


class IngestionError(ValueError):
    pass


class OCRUnavailable(IngestionError):
    pass


def tesseract_available() -> bool:
    command = os.environ.get("TESSERACT_CMD", "tesseract")
    return bool(shutil.which(command) or Path(command).is_file())


def ocr(image: Image.Image, number: int) -> Page:
    if not tesseract_available():
        raise OCRUnavailable("This document needs OCR. Install Tesseract and add it to PATH, or set TESSERACT_CMD to its executable. Digital PDFs and word JSON work without it.")
    pytesseract.pytesseract.tesseract_cmd = os.environ.get("TESSERACT_CMD", "tesseract")
    if image.width * image.height > MAX_PIXELS:
        raise IngestionError("Image exceeds the 24 megapixel limit; resize it before uploading.")
    try:
        data = pytesseract.image_to_data(image.convert("RGB"), output_type=pytesseract.Output.DICT,
                                        config="--psm 3", timeout=30)
    except pytesseract.TesseractError as exc:
        raise IngestionError("Tesseract could not read this image. Check the local OCR installation.") from exc
    except RuntimeError as exc:
        raise IngestionError("OCR timed out after 30 seconds on a page; upload a smaller image.") from exc
    words = []
    for i, text in enumerate(data["text"]):
        text = text.strip()
        confidence = float(data["conf"][i])
        if not text or confidence < 0 or data["width"][i] <= 0 or data["height"][i] <= 0:
            continue
        x, y, w, h = (int(data[key][i]) for key in ("left", "top", "width", "height"))
        words.append(Word(text=text, confidence=min(1, confidence / 100), bbox=Box(x0=x, y0=y, x1=x + w, y1=y + h)))
    if len(words) > 12000:
        raise IngestionError("A page contains more than 12,000 OCR words.")
    return Page(number=number, width=image.width, height=image.height, source="ocr", words=words)


def ingest_pdf(data: bytes, filename: str) -> Document:
    try:
        pdf = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise IngestionError("This PDF is damaged or is not a valid PDF.") from exc
    with pdf:
        if pdf.needs_pass:
            raise IngestionError("Password-protected PDFs are unsupported; upload an unlocked copy.")
        if not 1 <= len(pdf) <= MAX_PAGES:
            raise IngestionError(f"Upload a PDF with 1–{MAX_PAGES} pages.")
        pages = []
        notes = []
        for index, page in enumerate(pdf):
            raw_words = page.get_text("words", sort=True)
            if len(raw_words) > 12000:
                raise IngestionError("A page contains more than 12,000 words.")
            if len(raw_words) >= 3:
                words = [Word(text=w[4], bbox=Box(x0=max(0, w[0]), y0=max(0, w[1]), x1=w[2], y1=w[3]))
                         for w in raw_words if w[4].strip() and w[2] > max(0, w[0]) and w[3] > max(0, w[1])]
                pages.append(Page(number=index + 1, width=page.rect.width, height=page.rect.height, source="digital", words=words))
                if page.get_images() and len(raw_words) < 20:
                    notes.append(f"Page {index + 1} has a sparse text layer and images; embedded scanned content may need OCR.")
            else:
                scale = min(200 / 72, (MAX_PIXELS / max(1, page.rect.width * page.rect.height)) ** .5)
                pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
                image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                try:
                    pages.append(ocr(image, index + 1))
                finally:
                    image.close()
        return Document(filename=filename, pages=pages, warnings=notes)


def ingest(data: bytes, filename: str) -> Document:
    if not data:
        raise IngestionError("The uploaded file is empty.")
    if len(data) > MAX_BYTES:
        raise IngestionError("The maximum file size is 20 MB.")
    filename = filename.replace("\\", "/").rsplit("/", 1)[-1][:255] or "invoice"
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise IngestionError("Use a PDF, PNG, JPEG, TIFF, or normalized word JSON file.")
    if extension == ".json":
        try:
            doc = Document.model_validate_json(data)
            return doc.model_copy(update={"filename": filename})
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            raise IngestionError("Invalid word JSON. Use the documented pages/words/bbox schema; check page bounds and confidence values.") from exc
    if extension == ".pdf":
        return ingest_pdf(data, filename)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if getattr(image, "n_frames", 1) > MAX_PAGES:
                    raise IngestionError(f"Upload an image with at most {MAX_PAGES} frames.")
                pages = []
                for index in range(getattr(image, "n_frames", 1)):
                    image.seek(index)
                    if image.width * image.height > MAX_PIXELS:
                        raise IngestionError("Image exceeds the 24 megapixel limit.")
                    frame = ImageOps.exif_transpose(image)
                    try:
                        pages.append(ocr(frame, index + 1))
                    finally:
                        if frame is not image:
                            frame.close()
                return Document(filename=filename, pages=pages)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise IngestionError("This image is damaged, unsupported, or too large.") from exc

