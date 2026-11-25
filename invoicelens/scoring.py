"""Reproducible per-field and exact line-item scoring against human labels."""
from __future__ import annotations

import json
import re
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .engine import extract
from .ingest import ingest

FIELDS = ("vendor", "invoice_number", "date", "currency", "subtotal", "tax", "discount", "shipping", "total", "needs_review")
MONEY_FIELDS = {"subtotal", "tax", "discount", "shipping", "total"}


def normalize(value):
    return re.sub(r"\s+", " ", str(value).strip()).casefold() if value is not None else None


def equal(field, predicted, expected):
    if predicted is None or expected is None:
        return predicted is expected
    if field in MONEY_FIELDS:
        try:
            return abs(Decimal(str(predicted)) - Decimal(str(expected))) <= Decimal("0.01")
        except InvalidOperation:
            return False
    if field == "needs_review":
        return isinstance(expected, bool) and predicted is expected
    return normalize(predicted) == normalize(expected)


def line_key(line):
    return normalize(line["description"]), Decimal(str(line["amount"])).quantize(Decimal("0.01"))


def evaluate(manifest_path: Path, split: str = "dev") -> dict:
    manifest_path = manifest_path.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest.get("synthetic"), bool):
        raise ValueError("Manifest must explicitly declare synthetic: true or false.")
    entries = manifest.get("documents", [])
    ids = [entry["id"] for entry in entries]
    if len(set(ids)) != len(ids):
        raise ValueError("Document IDs must be unique across splits.")
    input_paths = [str((manifest_path.parent / entry["input"]).resolve()) for entry in entries]
    if len(set(input_paths)) != len(input_paths):
        raise ValueError("An input document may appear in only one split.")
    selected = [entry for entry in entries if entry.get("split") == split]
    if not selected:
        raise ValueError(f"No documents found in split '{split}'.")
    counts = {field: {"correct": 0, "total": 0} for field in FIELDS}
    tp = predicted_count = expected_count = 0
    document_results = []
    for entry in selected:
        source = manifest_path.parent / entry["input"]
        truth = json.loads((manifest_path.parent / entry["ground_truth"]).read_text(encoding="utf-8"))
        predicted = extract(ingest(source.read_bytes(), source.name)).model_dump(mode="json")
        field_results = {}
        for field in FIELDS:
            # Omitted ground-truth fields are unscored, never treated as correct.
            if field not in truth:
                continue
            correct = equal(field, predicted.get(field), truth[field])
            counts[field]["total"] += 1
            counts[field]["correct"] += int(correct)
            field_results[field] = correct
        if "line_items" not in truth:
            raise ValueError(f"Ground truth for '{entry['id']}' must include line_items.")
        expected = Counter(line_key(line) for line in truth["line_items"])
        actual = Counter(line_key(line) for line in predicted["line_items"])
        matches = sum((expected & actual).values())
        tp += matches
        expected_count += sum(expected.values())
        predicted_count += sum(actual.values())
        document_results.append({"id": entry["id"], "fields": field_results, "line_matches": matches,
                                 "predicted_lines": sum(actual.values()), "expected_lines": sum(expected.values()),
                                 "needs_review": predicted["needs_review"]})
    for value in counts.values():
        value["accuracy"] = round(value["correct"] / value["total"], 4) if value["total"] else None
    precision = tp / predicted_count if predicted_count else 0
    recall = tp / expected_count if expected_count else 0
    return {"dataset": manifest.get("name", manifest_path.stem), "synthetic": manifest["synthetic"], "split": split,
            "documents": len(selected), "fields": counts,
            "line_items": {"true_positives": tp, "predicted": predicted_count, "expected": expected_count,
                           "precision": round(precision, 4), "recall": round(recall, 4),
                           "f1": round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0},
            "results": document_results}

