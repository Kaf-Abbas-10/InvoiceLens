from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .engine import extract
from .ingest import MAX_BYTES, IngestionError, OCRUnavailable, ingest, tesseract_available
from .samples import SAMPLE_INFO, make_sample, sample_pdf

logger = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.extraction_slots = asyncio.Semaphore(2)
    yield


app = FastAPI(title="InvoiceLens", version="0.1.0", lifespan=lifespan,
              max_body_size=MAX_BYTES + 1024 * 1024,
              form_limits={"max_files": 1, "max_fields": 0})
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def privacy_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "engine": "rules-v1", "ocr_available": tesseract_available(),
            "storage": "none", "max_file_mb": 20, "max_pages": 20}


@app.get("/api/samples")
def samples():
    return [{"id": key, **value, "synthetic": True} for key, value in SAMPLE_INFO.items()]


@app.get("/api/samples/{sample_id}")
def get_sample(sample_id: str):
    if sample_id not in SAMPLE_INFO:
        raise HTTPException(404, "Sample not found.")
    document = make_sample(sample_id)
    return {"document": document.model_dump(mode="json"), "extraction": extract(document).model_dump(mode="json"), "synthetic": True}


@app.get("/api/samples/{sample_id}/pdf")
def get_sample_pdf(sample_id: str):
    if sample_id not in SAMPLE_INFO:
        raise HTTPException(404, "Sample not found.")
    return Response(sample_pdf(make_sample(sample_id)), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{sample_id}.pdf"'})


@app.post("/api/extract")
async def extract_upload(file: UploadFile = File(...)):
    try:
        data = await file.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "The maximum file size is 20 MB.")
        async with app.state.extraction_slots:
            document = await run_in_threadpool(ingest, data, file.filename or "invoice")
            result = await run_in_threadpool(extract, document)
        return {"document": document.model_dump(mode="json"), "extraction": result.model_dump(mode="json"), "synthetic": False}
    except OCRUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except IngestionError as exc:
        raise HTTPException(422, str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Invoice extraction failed")
        raise HTTPException(422, "The document could not be processed. Check that it is valid and within the documented limits.") from exc
    finally:
        await file.close()

