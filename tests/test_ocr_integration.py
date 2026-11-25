"""Real-engine smoke test, skipped when the local OCR binary is absent."""
import io

import pytest
from PIL import Image, ImageDraw, ImageFont

from invoicelens.ingest import ingest, tesseract_available


@pytest.mark.skipif(not tesseract_available(), reason="Local Tesseract executable is not installed")
def test_real_tesseract_reads_a_clean_scan():
    image = Image.new("RGB", (1500, 500), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=42)
    draw.text((70, 70), "INVOICE No: TEST-123", font=font, fill="black")
    draw.text((70, 170), "Inspection", font=font, fill="black")
    draw.text((1000, 170), "100.00", font=font, fill="black")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    result = ingest(buffer.getvalue(), "scan.png")
    assert result.pages[0].source == "ocr"
    text = " ".join(w.text for w in result.pages[0].words)
    assert "INVOICE" in text and "100.00" in text

