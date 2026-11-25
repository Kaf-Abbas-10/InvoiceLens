"""Generate fixtures. Ground truth is hand-authored, never parser output."""
import json
from pathlib import Path

from invoicelens.samples import make_sample

ROOT = Path(__file__).resolve().parents[1] / "data" / "synthetic"
LINES = {
    "fleet-service": [("Engine oil & filter", "120.00"), ("Brake inspection", "85.00"), ("Workshop labour", "180.00")],
    "side-by-side": [("Air filter", "45.00"), ("Diagnostics", "80.00"), ("Belt kit", "75.00"), ("Installation", "120.00")],
    "review-required": [("Engine oil & filter", "120.00"), ("Brake inspection", "85.00"), ("Workshop labour", "180.00")],
    "multiline": [("Engine oil & filter", "120.00"), ("Brake inspection", "85.00"), ("Workshop labour including diagnostic scan", "180.00")],
    "job-blocks": [("Brake pads", "100.00"), ("Fitting", "60.00"), ("Tyre rotation", "40.00")],
    "multi-page": [("Annual inspection", "200.00"), ("Replacement hoses", "75.00"), ("Road test", "25.00")],
    "credit": [("Replacement pump", "150.00"), ("Returned core credit", "-25.00")],
    "no-header": [("Safety inspection", "100.00"), ("Fluid top-up", "20.00")],
}
TOTALS = {"fleet-service": ("385.00", "38.50", "423.50"), "side-by-side": ("320.00", "32.00", "352.00"),
          "review-required": ("385.00", "38.50", "433.50"), "multiline": ("385.00", "38.50", "423.50"),
          "job-blocks": ("200.00", "20.00", "220.00"), "multi-page": ("300.00", "30.00", "330.00"),
          "credit": ("125.00", "12.50", "137.50"), "no-header": ("120.00", "12.00", "132.00")}


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    entries = []
    for sample_id, lines in LINES.items():
        (ROOT / f"{sample_id}.words.json").write_text(make_sample(sample_id).model_dump_json(indent=2) + "\n", encoding="utf-8")
        subtotal, tax, total = TOTALS[sample_id]
        truth = {"vendor": "Atlas Repair Works" if sample_id == "side-by-side" else "Northstar Fleet Services",
                 "invoice_number": "AR-917" if sample_id == "side-by-side" else "NFS-2048", "date": "2026-11-24",
                 "currency": "USD", "subtotal": subtotal, "tax": tax, "shipping": None, "discount": None, "total": total,
                 "needs_review": sample_id == "review-required",
                 "line_items": [{"description": text, "amount": amount} for text, amount in lines]}
        (ROOT / f"{sample_id}.truth.json").write_text(json.dumps(truth, indent=2) + "\n", encoding="utf-8")
        entries.append({"id": sample_id, "input": f"{sample_id}.words.json", "ground_truth": f"{sample_id}.truth.json", "split": "dev"})
    manifest = {"name": "InvoiceLens synthetic rule fixtures (development only)", "synthetic": True,
                "notes": "Hand-authored ground truth. These fixtures were used during development and are NOT an unseen benchmark.", "documents": entries}
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} labelled synthetic development fixtures to {ROOT}")


if __name__ == "__main__":
    main()

