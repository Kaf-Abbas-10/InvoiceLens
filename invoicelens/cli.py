import argparse
import csv
import io
import json
import sys
from pathlib import Path

from .engine import extract
from .ingest import IngestionError, ingest
from .samples import SAMPLE_INFO, make_sample, sample_pdf
from .scoring import evaluate


def output(text: str, destination: str | None):
    if destination:
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


def main():
    parser = argparse.ArgumentParser(description="InvoiceLens — local, rule-based invoice extraction")
    sub = parser.add_subparsers(dest="command", required=True)
    server = sub.add_parser("serve", help="Start the local review workspace")
    server.add_argument("--host", default="127.0.0.1")
    server.add_argument("--port", type=int, default=8000)
    server.add_argument("--reload", action="store_true")
    extraction = sub.add_parser("extract", help="Extract an invoice as JSON or CSV")
    extraction.add_argument("input", type=Path)
    extraction.add_argument("--format", choices=["json", "csv"], default="json")
    extraction.add_argument("--output", "-o")
    words = sub.add_parser("words", help="Save normalized words + bounding boxes for labelling")
    words.add_argument("input", type=Path)
    words.add_argument("--output", "-o")
    score = sub.add_parser("score", help="Score a labelled development or held-out dataset")
    score.add_argument("manifest", type=Path)
    score.add_argument("--split", choices=["dev", "held-out"], default="dev")
    score.add_argument("--output", "-o")
    samples = sub.add_parser("samples", help="Write synthetic sample word JSON and PDFs")
    samples.add_argument("--output", "-o", default="data/samples")
    args = parser.parse_args()
    try:
        if args.command == "serve":
            import uvicorn
            uvicorn.run("invoicelens.api:app", host=args.host, port=args.port, reload=args.reload)
            return
        if args.command == "score":
            output(json.dumps(evaluate(args.manifest, args.split), indent=2), args.output)
            return
        if args.command == "samples":
            directory = Path(args.output)
            directory.mkdir(parents=True, exist_ok=True)
            for key in SAMPLE_INFO:
                doc = make_sample(key)
                (directory / f"{key}.json").write_text(doc.model_dump_json(indent=2) + "\n", encoding="utf-8")
                (directory / f"{key}.pdf").write_bytes(sample_pdf(doc))
            print(f"Wrote {len(SAMPLE_INFO)} synthetic JSON/PDF pairs to {directory}")
            return
        data = args.input.read_bytes()
        document = ingest(data, args.input.name)
        if args.command == "words":
            output(document.model_dump_json(indent=2), args.output)
            return
        result = extract(document)
        if args.format == "json":
            output(result.model_dump_json(indent=2), args.output)
        else:
            stream = io.StringIO(newline="")
            writer = csv.writer(stream)
            writer.writerow(["description", "amount", "quantity", "unit_price", "page", "section", "confidence", "needs_review"])
            for line in result.line_items:
                # Prevent spreadsheet formulas in untrusted descriptions/sections.
                def safe(value):
                    text = str(value or "")
                    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text
                writer.writerow([safe(line.description), line.amount, line.quantity, line.unit_price,
                                 line.page, safe(line.section), line.confidence, result.needs_review])
            output(stream.getvalue().rstrip(), args.output)
    except (IngestionError, ValueError, OSError, KeyError) as exc:
        print(f"InvoiceLens: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()

