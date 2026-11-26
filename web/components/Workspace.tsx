"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Entry, ExtractResponse, Health, Sample } from "@/lib/types";
import { exportFile, fetchJSON, money, plural } from "@/lib/format";
import DocumentDesk from "./DocumentDesk";
import Ledger from "./Ledger";
import {
  IconAlert, IconArrowUpRight, IconBook, IconCheck, IconChevron, IconClose, IconCode, IconDownload, IconFile,
  IconLock, IconMenu, IconUpload, Logo,
} from "./Icons";

const MAX_HISTORY = 12;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.json";
const FIRST_SAMPLE = "fleet-service";

const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const release = (e?: Entry) => { if (e?.originalUrl?.startsWith("blob:")) URL.revokeObjectURL(e.originalUrl); };

export default function Workspace() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [health, setHealth] = useState<Health | null | "down">(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [original, setOriginal] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>("Running the layout rules…");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [dragging, setDragging] = useState(false);

  const request = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const guide = useRef<HTMLDialogElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dragDepth = useRef(0);
  const entriesRef = useRef<Entry[]>([]);

  const active = entries.find((e) => e.key === activeKey) ?? null;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const addEntry = useCallback((data: Omit<Entry, "key">) => {
    const entry: Entry = { ...data, key: newKey() };
    setEntries((prev) => {
      const next = [entry, ...prev];
      while (next.length > MAX_HISTORY) release(next.pop());
      entriesRef.current = next;
      return next;
    });
    setActiveKey(entry.key);
    setPage(1);
    setOriginal(false);
    setSelected(null);
    setHovered(null);
  }, []);

  const loadSample = useCallback(async (id: string) => {
    const req = ++request.current;
    setError(null);
    setBusy("Running the layout rules…");
    setDrawer(false);
    try {
      const data = await fetchJSON<ExtractResponse>(`/api/samples/${encodeURIComponent(id)}`);
      if (req !== request.current) return;
      addEntry({ ...data, sampleId: id, originalUrl: `/api/samples/${encodeURIComponent(id)}/pdf`, originalType: "pdf" });
    } catch (e) {
      if (req === request.current) setError(e instanceof Error ? e.message : "Could not load the example.");
    } finally {
      if (req === request.current) setBusy(null);
    }
  }, [addEntry]);

  const upload = useCallback(async (file?: File | null) => {
    if (!file) return;
    setError(null);
    setDrawer(false);
    if (file.size > 20 * 1024 * 1024) { setError("This file is larger than 20 MB. Please choose a smaller invoice."); return; }
    if (!/\.(pdf|png|jpe?g|tiff?|json)$/i.test(file.name)) { setError("Choose a PDF, PNG, JPG, TIFF, or normalised word JSON file."); return; }
    const req = ++request.current;
    setBusy("Reading words, locating charges and checking the maths…");
    const form = new FormData();
    form.append("file", file);
    try {
      const data = await fetchJSON<ExtractResponse>("/api/extract", { method: "POST", body: form });
      if (req !== request.current) return;
      const pdf = /\.pdf$/i.test(file.name);
      const image = /\.(png|jpe?g)$/i.test(file.name);
      addEntry({ ...data, originalUrl: pdf || image ? URL.createObjectURL(file) : null, originalType: pdf ? "pdf" : image ? "image" : null });
      notify("Extraction complete. Check the results before you use them.");
    } catch (e) {
      if (req === request.current) setError(e instanceof Error ? e.message : "Upload failed. Check that the engine is running.");
    } finally {
      if (req === request.current) setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }, [addEntry, notify]);

  // First visit: health, examples, and one invoice already open so there's something to explore.
  useEffect(() => {
    let live = true;
    fetchJSON<Health>("/api/health").then((h) => live && setHealth(h)).catch(() => live && setHealth("down"));
    fetchJSON<Sample[]>("/api/samples").then((s) => live && setSamples(s)).catch(() => {});
    const req = ++request.current;
    fetchJSON<ExtractResponse>(`/api/samples/${FIRST_SAMPLE}`)
      .then((data) => { if (live && req === request.current) addEntry({ ...data, sampleId: FIRST_SAMPLE, originalUrl: `/api/samples/${FIRST_SAMPLE}/pdf`, originalType: "pdf" }); })
      .catch((e) => { if (live && req === request.current) setError(e instanceof Error ? e.message : "Could not reach the engine."); })
      .finally(() => { if (live && req === request.current) setBusy(null); });
    return () => { live = false; };
  }, [addEntry]);

  useEffect(() => () => { entriesRef.current.forEach(release); clearTimeout(toastTimer.current); }, []);

  const pick = useCallback((i: number | null) => {
    setSelected(i);
    if (i === null || !active) return;
    setOriginal(false);
    setPage(active.extraction.line_items[i].page);
    // On narrow screens the page is above the ledger: bring it into view.
    const el = deskRef.current;
    if (el && window.innerWidth < 1280) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 80 || r.top > window.innerHeight - 80) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [active]);

  const open = (key: string) => {
    setActiveKey(key); setPage(1); setOriginal(false); setSelected(null); setHovered(null); setDrawer(false); setError(null);
  };

  const clearSession = () => {
    if (busy) return;
    entries.forEach(release);
    entriesRef.current = [];
    setEntries([]); setActiveKey(null); setSelected(null); setError(null);
    notify("Session cleared. Nothing was saved on the server.");
  };

  const doExport = (format: "json" | "csv") => {
    if (!active) return;
    exportFile(active.extraction, format);
    notify(format === "csv" ? "Line items exported as CSV." : "Extraction, checks and flags exported as JSON.");
  };

  // Drop a file anywhere on the page
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const dragProps = {
    onDragEnter: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true); },
    onDragOver: (e: React.DragEvent) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: (e: React.DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth.current = 0; setDragging(false);
      if (busy) return;
      if (e.dataTransfer.files.length > 1) { setError("Upload one invoice at a time. Multi-page PDFs are supported."); return; }
      upload(e.dataTransfer.files[0]);
    },
  };

  const rail = (
    <Rail samples={samples} entries={entries} activeKey={activeKey} activeSample={active?.sampleId} busy={!!busy} health={health}
      onUpload={() => fileInput.current?.click()} onSample={loadSample} onOpen={open} onClear={clearSession}
      onGuide={() => { setDrawer(false); guide.current?.showModal(); }} />
  );

  return (
    <div className="min-h-screen lg:flex" {...dragProps}>
      <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(e) => upload(e.target.files?.[0])} />

      {/* Desktop rail: full height, sticky */}
      <aside className="sticky top-0 hidden h-screen w-[288px] shrink-0 lg:block">{rail}</aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-card/95 px-4 py-3 text-ink backdrop-blur lg:hidden">
        <button onClick={() => setDrawer(true)} className="-ml-1 flex items-center gap-2.5" aria-label="Open menu">
          <IconMenu size={20} />
          <span className="flex items-center gap-2"><Logo size={26} /><span className="font-serif text-xl leading-none">InvoiceLens</span></span>
        </button>
        <button onClick={() => fileInput.current?.click()} disabled={!!busy}
          className="flex items-center gap-1.5 rounded-lg bg-marker px-3 py-1.5 text-sm font-semibold text-rail disabled:opacity-60">
          <IconUpload size={15} />Upload
        </button>
      </div>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="fade absolute inset-0 bg-ink/35" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <div className="rise absolute inset-y-0 left-0 w-[86%] max-w-[320px] shadow-2xl">
            {rail}
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-md p-1.5 text-rail-muted hover:text-rail-ink" aria-label="Close menu"><IconClose size={18} /></button>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1360px] px-4 pb-10 pt-6 sm:px-6 lg:px-10 lg:pt-9">
          {error && (
            <div role="alert" className="rise mb-5 flex items-start gap-3 rounded-xl border border-fail/25 bg-fail-soft px-4 py-3 text-sm text-fail">
              <IconAlert size={17} className="mt-0.5 shrink-0" />
              <p className="flex-1">{error}</p>
              <button onClick={() => setError(null)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100"><IconClose size={16} /></button>
            </div>
          )}

          {active ? (
            <Results key={active.key} entry={active} busy={busy} page={page} original={original} selected={selected} hovered={hovered}
              deskRef={deskRef} onPage={(n) => { setPage(n); }} onOriginal={setOriginal} onPick={pick} onHover={setHovered} onExport={doExport} />
          ) : busy ? (
            <LoadingSheet text={busy} />
          ) : (
            <Empty samples={samples} onUpload={() => fileInput.current?.click()} onSample={loadSample} />
          )}
        </div>
      </main>

      {dragging && (
        <div className="fade pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-white/70 p-6 backdrop-blur-[2px]">
          <div className="rise flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-marker bg-card px-12 py-10 text-center text-ink shadow-xl">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-marker text-rail"><IconUpload size={26} /></span>
            <p className="font-serif text-3xl">Drop to extract</p>
            <p className="text-sm text-rail-muted">PDF, image or word JSON · one file · up to 20 MB</p>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="rise fixed bottom-5 left-1/2 z-[70] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2.5 rounded-full bg-ink px-4 py-2.5 text-sm text-white shadow-xl">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-marker text-rail"><IconCheck size={12} /></span>
          {toast}
        </div>
      )}

      <Guide ref={guide} />
    </div>
  );
}

/* ---------- Rail ---------- */

function Rail({ samples, entries, activeKey, activeSample, busy, health, onUpload, onSample, onOpen, onClear, onGuide }: {
  samples: Sample[]; entries: Entry[]; activeKey: string | null; activeSample?: string; busy: boolean; health: Health | null | "down";
  onUpload: () => void; onSample: (id: string) => void; onOpen: (key: string) => void; onClear: () => void; onGuide: () => void;
}) {
  return (
    <div className="rail-scroll flex h-full flex-col overflow-y-auto border-r border-line bg-rail text-rail-ink">
      <div className="px-5 pb-5 pt-6">
        <div className="flex items-center gap-2.5">
          <Logo size={32} />
          <span>
            <span className="block font-serif text-[26px] leading-none tracking-tight">InvoiceLens</span>
          </span>
        </div>
        <button onClick={onUpload} disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-marker px-4 py-3 text-sm font-semibold text-rail shadow-[0_6px_20px_-8px_rgba(79,70,229,.55)] transition hover:brightness-105 active:translate-y-px disabled:opacity-60">
          <IconUpload size={16} />Upload invoice
        </button>
        <p className="mt-2 text-center text-[11px] text-rail-muted">PDF, image or JSON</p>
      </div>

      <RailSection title="Examples">
        <ul className="space-y-0.5">
          {samples.map((s) => {
            const on = activeSample === s.id;
            return (
              <li key={s.id}>
                <button onClick={() => onSample(s.id)} disabled={busy} title={s.description} aria-current={on ? "true" : undefined}
                  className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition disabled:opacity-60 ${on ? "bg-marker-soft" : "hover:bg-soft"}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.id === "review-required" ? "bg-[#e0894e]" : on ? "bg-marker" : "bg-rail-line group-hover:bg-rail-muted"}`} />
                  <span className="min-w-0">
                    <span className={`block text-[13px] font-medium ${on ? "text-rail-ink" : "text-rail-ink/85"}`}>{s.title}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {!samples.length && <li className="px-2.5 py-2 text-xs text-rail-muted">Loading examples…</li>}
        </ul>
      </RailSection>

      <RailSection title={`This session${entries.length ? ` · ${entries.length}` : ""}`}
        action={entries.length ? <button onClick={onClear} disabled={busy} className="text-[11px] font-medium text-rail-muted underline-offset-4 hover:text-rail-ink hover:underline disabled:opacity-50">Clear</button> : null}>
        {entries.length ? (
          <ul className="space-y-0.5">
            {entries.map((e) => {
              const on = e.key === activeKey;
              return (
                <li key={e.key}>
                  <button onClick={() => onOpen(e.key)} title={e.extraction.filename}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${on ? "bg-marker-soft text-ink" : "text-rail-ink/80 hover:bg-soft"}`}>
                    <IconFile size={15} className="shrink-0 text-rail-muted" />
                    <span className="min-w-0 flex-1 truncate">{e.extraction.filename}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${e.extraction.needs_review ? "bg-[#e0894e]" : "bg-[#6cc28f]"}`}
                      aria-label={e.extraction.needs_review ? "Needs review" : "Checks passed"} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-2.5 text-xs leading-relaxed text-rail-muted">Opened invoices appear here.</p>
        )}
      </RailSection>

      <div className="mt-auto space-y-4 px-5 pb-5 pt-6">
        <div className="flex gap-1">
          <button onClick={onGuide} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-rail-line px-2 py-2 text-xs text-rail-ink/85 transition hover:bg-rail-2">
            <IconBook size={14} />How it works
          </button>
          <a href="/docs" target="_blank" rel="noopener" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-rail-line px-2 py-2 text-xs text-rail-ink/85 transition hover:bg-rail-2">
            <IconCode size={14} />API<IconArrowUpRight size={11} />
          </a>
        </div>
        <div className="rounded-xl border border-rail-line bg-bg p-3.5">
          <p className="flex items-center gap-2 text-[12.5px] font-medium"><IconLock size={14} className="text-marker" />Private · runs locally</p>
          <p className="mt-2 flex items-center gap-2 text-[11px] text-rail-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${health === "down" ? "bg-[#e0634e]" : health ? "bg-[#6cc28f]" : "bg-rail-line"}`} />
            {health === "down" ? "Engine unreachable" : health ? `Engine ready${health.ocr_available ? " · OCR on" : ""}` : "Checking engine…"}
          </p>
        </div>
      </div>
    </div>
  );
}

function RailSection({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-t border-rail-line px-3 py-4">
      <div className="mb-2 flex items-center justify-between px-2.5">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-rail-muted">{title}</h2>
        {hint && <span className="text-[10.5px] text-rail-muted/70">{hint}</span>}
        {action}
      </div>
      {children}
    </div>
  );
}

/* ---------- Results ---------- */

function Results({ entry, busy, page, original, selected, hovered, deskRef, onPage, onOriginal, onPick, onHover, onExport }: {
  entry: Entry; busy: string | null; page: number; original: boolean; selected: number | null; hovered: number | null;
  deskRef: React.RefObject<HTMLDivElement | null>;
  onPage: (n: number) => void; onOriginal: (v: boolean) => void; onPick: (i: number | null) => void; onHover: (i: number | null) => void;
  onExport: (f: "json" | "csv") => void;
}) {
  const r = entry.extraction;
  const pass = r.checks.filter((c) => c.status === "pass").length;
  const fails = r.checks.filter((c) => c.status === "fail").length;

  return (
    <div className="rise">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-[34px] leading-[1.05] tracking-tight sm:text-[44px]">
            {r.vendor ?? r.filename}
          </h1>
          <p className="mt-1 truncate text-sm text-muted">{r.invoice_number ? `Invoice ${r.invoice_number}` : r.filename}{entry.synthetic ? " · example" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${r.needs_review ? "bg-review-soft text-review" : "bg-pass-soft text-pass"}`}>
            {r.needs_review ? <IconAlert size={13} /> : <IconCheck size={13} />}
            {r.needs_review ? "Needs review" : "Checks passed"}
          </span>
          <ExportMenu onExport={onExport} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Invoice total" big={money(r.total, r.currency)} sub={r.tax ? `incl. ${money(r.tax, r.currency)} tax` : r.currency ?? ""} feature />
        <Stat label="Charges found" big={String(r.line_items.length)} sub={plural(r.page_count, "page")} />
        <Stat label="Maths checks" big={`${pass}/${r.checks.length}`} sub={fails ? plural(fails, "mismatch") : "All passed"}
          bar={r.checks.map((c) => c.status)} />
        <Stat label="To check" big={String(r.flags.length)} sub={r.flags.length ? "See notes below" : "Nothing to check"} tone={r.flags.length ? "review" : "pass"} />
      </div>

      <div className="relative mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] xl:items-start">
        <div ref={deskRef} className="scroll-mt-20 xl:sticky xl:top-6">
          <DocumentDesk entry={entry} page={page} original={original} selected={selected} hovered={hovered}
            onPage={onPage} onOriginal={onOriginal} onPick={onPick} onHover={onHover} />
        </div>
        <Ledger entry={entry} selected={selected} hovered={hovered} onPick={onPick} onHover={onHover} />
        {busy && (
          <div className="fade absolute inset-0 z-10 flex items-start justify-center rounded-2xl bg-bg/60 pt-24 backdrop-blur-[1.5px]">
            <BusyPill text={busy} />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, big, sub, feature, tone, bar }: {
  label: string; big: string; sub: string; feature?: boolean; tone?: "pass" | "review"; bar?: ("pass" | "fail" | "unavailable")[];
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border px-4 py-4 sm:px-5 ${feature ? "border-marker/30 bg-marker-soft text-ink" : "border-line-strong/70 bg-card"}`}>
      {feature && <span className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-marker/20 blur-xl" aria-hidden />}
      <p className={`text-[11px] font-medium uppercase tracking-[.14em] ${feature ? "text-rail-muted" : "text-faint"}`}>{label}</p>
      <p className={`num mt-2 truncate font-serif text-[30px] leading-none sm:text-[36px] ${tone === "review" ? "text-review" : ""}`}>{big}</p>
      {bar && bar.length > 0 && (
        <div className="mt-2.5 flex gap-1" aria-hidden>
          {bar.map((s, i) => <span key={i} className={`h-1 flex-1 rounded-full ${s === "pass" ? "bg-pass" : s === "fail" ? "bg-fail" : "bg-line-strong"}`} />)}
        </div>
      )}
      <p className={`mt-2 truncate text-xs ${feature ? "text-rail-muted" : "text-muted"}`}>{sub}</p>
    </div>
  );
}

function ExportMenu({ onExport }: { onExport: (f: "json" | "csv") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-full bg-card px-4 py-1.5 text-xs font-semibold text-ink ring-1 ring-line-strong transition hover:ring-marker">
        <IconDownload size={14} />Export<IconChevron size={13} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="rise absolute right-0 top-full z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-card p-1 shadow-xl">
          {([["json", "JSON", "Full extraction, checks and flags"], ["csv", "CSV", "Line items, ready for a spreadsheet"]] as const).map(([f, t, d]) => (
            <button key={f} role="menuitem" onClick={() => { setOpen(false); onExport(f); }}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-soft">
              <span className="mt-0.5 rounded bg-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-2">.{f}</span>
              <span><span className="block text-sm font-medium">{t}</span><span className="block text-xs text-muted">{d}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BusyPill({ text }: { text: string }) {
  return (
    <div role="status" className="rise flex items-center gap-3 rounded-full bg-card px-5 py-3 text-sm text-ink shadow-xl ring-1 ring-line">
      <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-marker opacity-70" /><span className="relative h-2.5 w-2.5 rounded-full bg-marker" /></span>
      {text}
    </div>
  );
}

function LoadingSheet({ text }: { text: string }) {
  return (
    <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_1fr] lg:items-center">
      <div className="desk relative mx-auto w-full max-w-[420px] overflow-hidden rounded-2xl p-8">
        <div className="paper-shadow relative aspect-[1/1.3] overflow-hidden rounded-[3px] bg-paper p-7">
          {[60, 38, 44, 0, 90, 82, 86, 0, 30, 34].map((w, i) => (
            <div key={i} className={w ? "mb-3 h-2 rounded bg-soft" : "mb-6"} style={{ width: `${w}%` }} />
          ))}
          <div className="scan-beam pointer-events-none absolute inset-x-0 -inset-y-full" />
        </div>
      </div>
      <div role="status" className="text-center lg:text-left">
        <p className="font-serif text-4xl tracking-tight">Reading the page…</p>
        <p className="mt-2 text-muted">{text}</p>
      </div>
    </div>
  );
}

function Empty({ samples, onUpload, onSample }: { samples: Sample[]; onUpload: () => void; onSample: (id: string) => void }) {
  const picks = samples.filter((s) => ["fleet-service", "side-by-side", "review-required"].includes(s.id));
  return (
    <div className="rise grid gap-10 pt-2 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-[.18em] text-faint">Invoice reading desk</p>
        <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight sm:text-[64px]">
          Every charge,<br /><span className="relative inline-block"><span className="absolute inset-x-[-4px] bottom-[10%] top-[38%] -z-10 rounded-sm bg-[var(--hl)]/60" aria-hidden />traced to the page.</span>
        </h1>
        <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted">
          Drop an invoice to pull out the vendor, line items and totals. Every number links back to where it sits on the page,
          and the arithmetic is checked before you trust it.
        </p>
        <button onClick={onUpload} className="mt-7 w-full max-w-lg rounded-2xl border-2 border-dashed border-line-strong bg-card/60 px-6 py-8 text-center transition hover:border-ink hover:bg-card">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-marker-soft text-marker"><IconUpload size={22} /></span>
          <span className="mt-3 block font-medium">Drop an invoice here, or <span className="underline decoration-marker decoration-2 underline-offset-4">browse files</span></span>
          <span className="mt-1 block text-xs text-muted">PDF, PNG, JPG, TIFF or word JSON · up to 20 MB and 20 pages</span>
        </button>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium text-ink-2">Or open an example</p>
        {picks.map((s) => (
          <button key={s.id} onClick={() => onSample(s.id)} className="group flex w-full items-center gap-4 rounded-2xl border border-line-strong/70 bg-card px-5 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-soft text-ink-2"><IconFile size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{s.title}</span>
              <span className="block truncate text-sm text-muted">{s.description}</span>
            </span>
            <IconArrowUpRight size={16} className="text-faint transition group-hover:text-ink" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Guide ---------- */

function Guide({ ref }: { ref: React.RefObject<HTMLDialogElement | null> }) {
  const steps = [
    ["Read locally", "Digital PDFs use their text layer. Scans and images use a locally installed Tesseract engine."],
    ["Follow the layout", "Words form rows, and aligned amounts identify charge columns. Each extracted line keeps its page and position."],
    ["Check the maths", "Charge totals, tax, discounts and job subtotals are reconciled with exact decimal arithmetic."],
    ["Take a second look", "Flags explain missing fields, low OCR confidence and mismatched totals. A passing check doesn't guarantee every field is right."],
  ];
  return (
    <dialog ref={ref} aria-labelledby="guide-title" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-3xl bg-card p-0 text-ink shadow-2xl">
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[.16em] text-faint">How it works</p>
            <h2 id="guide-title" className="mt-1 font-serif text-[34px] leading-tight">From document to details.</h2>
          </div>
          <button onClick={() => ref.current?.close()} aria-label="Close" className="rounded-full p-2 text-muted hover:bg-soft hover:text-ink"><IconClose size={18} /></button>
        </div>
        <p className="mt-2 text-sm text-muted">InvoiceLens uses page geometry and explicit rules. It never sends your invoice to an LLM or an outside extraction service.</p>
        <ol className="mt-6 space-y-4">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-4">
              <span className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-marker font-serif text-lg text-rail">{i + 1}</span>
              <div><p className="font-medium">{t}</p><p className="text-sm leading-relaxed text-muted">{d}</p></div>
            </li>
          ))}
        </ol>
        <p className="mt-6 rounded-xl bg-soft px-4 py-3 text-xs leading-relaxed text-muted">
          The examples are synthetic layout fixtures, not a real-world accuracy benchmark. Rule confidence is a heuristic, not a calibrated
          probability. Uploads are processed in memory (apart from temporary upload spooling), and session history lives only in this browser tab.
        </p>
        <a href="/docs" target="_blank" rel="noopener" className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-marker px-4 py-2 text-sm font-medium text-white hover:brightness-95">
          Explore the local API<IconArrowUpRight size={14} />
        </a>
      </div>
    </dialog>
  );
}
