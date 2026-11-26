import type { Extraction, LineItem, Page } from "./types";

export function money(value: string | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (currency) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
    } catch { /* unknown currency code: fall through */ }
  }
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const SOURCE_LABEL: Record<Page["source"], string> = {
  provided: "Word geometry", digital: "PDF text layer", ocr: "Local OCR",
};

export const CHECK_NAMES: Record<string, string> = {
  lines_match_subtotal: "Line items match subtotal",
  total_reconciles: "Invoice total reconciles",
  quantity_times_price: "Quantity × unit price",
  section_subtotal: "Job subtotal matches",
};

/** Neutralise spreadsheet formulas (=, +, -, @) so a CSV can't run code when opened. */
function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function exportFile(result: Extraction, format: "json" | "csv") {
  const csv = format === "csv";
  const header = ["vendor", "invoice_number", "date", "currency", "description", "quantity",
    "unit_price", "amount", "page", "section", "confidence", "needs_review"];
  const content = csv
    ? [header.join(","), ...result.line_items.map((l: LineItem) => [result.vendor, result.invoice_number,
      result.date, result.currency, l.description, l.quantity, l.unit_price, l.amount, l.page, l.section,
      l.confidence, result.needs_review].map(csvCell).join(","))].join("\r\n")
    : JSON.stringify(result, null, 2);
  const blob = new Blob([content], { type: csv ? "text/csv;charset=utf-8" : "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename.replace(/\.[^.]+$/, " ").trim().replace(/[^a-zA-Z0-9_-]/g, "_") + `-extracted.${format}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("The server returned an unreadable response. Check that the InvoiceLens engine is running.");
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail;
    throw new Error(typeof detail === "string" ? detail : "This document could not be processed.");
  }
  return data as T;
}
