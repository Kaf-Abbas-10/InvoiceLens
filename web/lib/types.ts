export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Word = { text: string; bbox: Box; confidence: number };
export type Page = {
  number: number; width: number; height: number;
  source: "digital" | "ocr" | "provided"; words: Word[];
};
export type InvoiceDocument = { filename: string; pages: Page[]; warnings: string[] };

/** Decimals arrive as strings (exact), so they are never rounded by JSON. */
export type Money = string | null;

export type LineItem = {
  description: string; amount: string; quantity: Money; unit_price: Money;
  page: number; bbox: Box; section: string | null; confidence: number;
};
export type MathCheck = {
  name: string; status: "pass" | "fail" | "unavailable";
  expected: Money; actual: Money; difference: Money; detail: string;
};
export type ReviewFlag = { code: string; message: string; page: number | null };

export type Extraction = {
  filename: string; vendor: string | null; invoice_number: string | null;
  date: string | null; raw_date: string | null; currency: string | null;
  subtotal: Money; tax: Money; discount: Money; shipping: Money; total: Money;
  line_items: LineItem[]; checks: MathCheck[]; flags: ReviewFlag[];
  needs_review: boolean; confidence: number; page_count: number; engine: string;
};

export type ExtractResponse = { document: InvoiceDocument; extraction: Extraction; synthetic: boolean };

export type Entry = ExtractResponse & {
  key: string;
  sampleId?: string;
  originalUrl: string | null;
  originalType: "pdf" | "image" | null;
};

export type Sample = { id: string; title: string; description: string; vendor: string; synthetic: boolean };

export type Health = {
  status: string; engine: string; ocr_available: boolean; storage: string;
  max_file_mb: number; max_pages: number;
};
