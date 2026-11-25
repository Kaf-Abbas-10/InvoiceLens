import json
import subprocess
import sys
from pathlib import Path

import pytest

from invoicelens.scoring import equal, evaluate

ROOT = Path(__file__).resolve().parents[1]


def test_synthetic_dataset_is_labelled_development_only():
    report = evaluate(ROOT / "data/synthetic/manifest.json")
    assert report["synthetic"] is True and report["split"] == "dev"
    assert report["documents"] == 8
    assert report["line_items"]["f1"] == 1
    assert all(f["accuracy"] == 1 for f in report["fields"].values())


def test_nonexistent_heldout_split_is_not_invented():
    with pytest.raises(ValueError, match="No documents"):
        evaluate(ROOT / "data/synthetic/manifest.json", "held-out")


def test_scoring_missing_nulls_and_money():
    assert equal("tax", None, None)
    assert not equal("tax", "0.00", None)
    assert equal("total", "12.00", "12.01")
    assert not equal("total", "12.00", "12.02")
    assert equal("vendor", " ACME  Parts ", "acme parts")
    assert not equal("needs_review", True, "true")


def test_cli_json_extraction():
    run = subprocess.run([sys.executable, "-m", "invoicelens.cli", "extract", str(ROOT / "data/synthetic/fleet-service.words.json")], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    result = json.loads(run.stdout)
    assert result["total"] == "423.50" and not result["needs_review"]


def test_cli_invalid_input_has_nonzero_exit():
    run = subprocess.run([sys.executable, "-m", "invoicelens.cli", "extract", "missing-file.pdf"], capture_output=True, text=True)
    assert run.returncode == 1
    assert "InvoiceLens:" in run.stderr

