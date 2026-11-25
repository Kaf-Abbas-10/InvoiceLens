import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from invoicelens.api import app
from invoicelens.engine import extract
from invoicelens.ingest import IngestionError, OCRUnavailable, ingest
from invoicelens.models import Box, Document
from invoicelens.samples import SAMPLE_INFO, make_sample, sample_pdf


@pytest.fixture
def client():
    with TestClient(app) as session:
        yield session


def test_home_and_static_assets(client):
    assert client.get("/").status_code == 200
    for asset in ("style.css", "app.js"):
        assert client.get(f"/static/{asset}").status_code == 200
    assert client.get("/").headers["cache-control"] == "no-store"


def test_health_reports_actual_ocr_availability(client):
    data = client.get("/api/health").json()
    assert data["status"] == "ok" and isinstance(data["ocr_available"], bool)
    assert data["storage"] == "none"


def test_samples_are_explicitly_synthetic(client):
    samples = client.get("/api/samples").json()
    assert len(samples) == 8 and all(s["synthetic"] for s in samples)
    assert client.get("/api/samples/does-not-exist").status_code == 404


def test_upload_word_json(client):
    response = client.post("/api/extract", files={"file": ("test.json", make_sample("fleet-service").model_dump_json(), "application/json")})
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data["extraction"]["line_items"]) == 3
    assert not data["extraction"]["needs_review"]
    assert not data["synthetic"]


@pytest.mark.parametrize("sample_id", list(SAMPLE_INFO))
def test_real_pdf_text_ingestion(sample_id):
    doc = make_sample(sample_id)
    pdf = sample_pdf(doc)
    actual = ingest(pdf, f"{sample_id}.pdf")
    assert len(actual.pages) == len(doc.pages)
    assert all(p.source == "digital" for p in actual.pages)
    result = extract(actual)
    expected = extract(doc)
    assert [i.description for i in result.line_items] == [i.description for i in expected.line_items]
    assert [i.amount for i in result.line_items] == [i.amount for i in expected.line_items]
    assert result.total == expected.total


def test_sample_pdf_is_downloadable(client):
    response = client.get("/api/samples/fleet-service/pdf")
    assert response.status_code == 200 and response.content.startswith(b"%PDF")


def test_upload_pdf_end_to_end(client):
    response = client.post("/api/extract", files={"file": ("invoice.pdf", sample_pdf(make_sample("side-by-side")), "application/pdf")})
    assert response.status_code == 200, response.text
    assert len(response.json()["extraction"]["line_items"]) == 4


@pytest.mark.parametrize("name,data", [("bad.pdf", b"not a PDF"), ("bad.json", b"{}"), ("bad.exe", b"hello"), ("empty.pdf", b"")])
def test_bad_uploads_return_useful_error(client, name, data):
    response = client.post("/api/extract", files={"file": (name, data)})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_file_size_limit(client):
    response = client.post("/api/extract", content=b"", headers={"content-length": str(22 * 1024 * 1024), "content-type": "application/octet-stream"})
    assert response.status_code == 413


def test_chunked_upload_size_limit(client):
    boundary = "invoice-test-boundary"
    def chunks():
        yield f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="huge.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode()
        for _ in range(22):
            yield b"x" * 1024 * 1024
        yield f'\r\n--{boundary}--\r\n'.encode()
    response = client.post("/api/extract", content=chunks(), headers={"content-type": f"multipart/form-data; boundary={boundary}"})
    assert response.status_code == 413


def test_invalid_coordinates_are_rejected(client):
    data = json.loads(make_sample("fleet-service").model_dump_json())
    data["pages"][0]["words"][0]["bbox"]["x1"] = 9999
    response = client.post("/api/extract", files={"file": ("invalid.json", json.dumps(data))})
    assert response.status_code == 422


def test_ocr_unavailable_has_actionable_error(client, monkeypatch):
    monkeypatch.setattr("invoicelens.ingest.tesseract_available", lambda: False)
    buffer = io.BytesIO()
    Image.new("RGB", (100,100), "white").save(buffer, format="PNG")
    response = client.post("/api/extract", files={"file": ("scan.png", buffer.getvalue(), "image/png")})
    assert response.status_code == 503
    assert "TESSERACT_CMD" in response.json()["detail"]


def test_ocr_word_conversion(monkeypatch):
    monkeypatch.setattr("invoicelens.ingest.tesseract_available", lambda: True)
    monkeypatch.setattr("invoicelens.ingest.pytesseract.image_to_data", lambda *a, **kw: {
        "text": ["", "Invoice", "120.00"], "conf": [-1, 98, 63], "left": [0, 10, 100], "top": [0, 10, 50], "width": [0, 50, 60], "height": [0, 12, 12]})
    buffer = io.BytesIO()
    Image.new("RGB", (300,200), "white").save(buffer, format="PNG")
    doc = ingest(buffer.getvalue(), "scan.png")
    assert doc.pages[0].source == "ocr"
    assert len(doc.pages[0].words) == 2
    assert doc.pages[0].words[1].confidence == .63


def test_word_json_requires_unique_ordered_pages():
    doc = make_sample("multi-page").model_dump()
    doc["pages"][1]["number"] = 1
    with pytest.raises(ValidationError):
        Document.model_validate(doc)


def test_box_requires_positive_finite_area():
    with pytest.raises(ValidationError):
        Box(x0=10, x1=5, y0=0, y1=12)
    with pytest.raises(ValidationError):
        Box(x0=0, x1=float("inf"), y0=0, y1=12)

