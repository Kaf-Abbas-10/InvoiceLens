"use client";

import type { Entry } from "@/lib/types";
import { SOURCE_LABEL } from "@/lib/format";
import { IconTrace } from "./Icons";

const PAD_X = 7;
const PAD_Y = 4;

type Props = {
  entry: Entry;
  page: number;
  original: boolean;
  selected: number | null;
  hovered: number | null;
  onPage: (n: number) => void;
  onOriginal: (v: boolean) => void;
  onPick: (i: number | null) => void;
  onHover: (i: number | null) => void;
};

/** The source document, on a desk. Word map = the engine's own view of the page (every word at its
 * coordinates); clicking a charge here or in the ledger draws the highlighter over its row. */
export default function DocumentDesk({ entry, page, original, selected, hovered, onPage, onOriginal, onPick, onHover }: Props) {
  const doc = entry.document;
  const p = doc.pages[page - 1] ?? doc.pages[0];
  const lines = entry.extraction.line_items;
  const onThisPage = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.page === p.number);
  const sel = selected !== null && lines[selected]?.page === p.number ? lines[selected] : null;
  const hov = hovered !== null && hovered !== selected && lines[hovered]?.page === p.number ? lines[hovered] : null;

  return (
    <section aria-labelledby="source-title" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line-strong/70 bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="source-title" className="text-sm font-semibold">Source document</h2>
          <p className="text-xs text-muted">{SOURCE_LABEL[p.source]}{doc.pages.length > 1 ? ` · page ${p.number} of ${doc.pages.length}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {doc.pages.length > 1 && (
            <div className="flex items-center gap-1" role="group" aria-label="Page">
              {doc.pages.map((pg) => (
                <button key={pg.number} onClick={() => onPage(pg.number)} aria-pressed={pg.number === p.number}
                  aria-label={`Page ${pg.number}`}
                  className={`num h-7 min-w-7 rounded-md px-2 text-xs font-medium transition ${pg.number === p.number ? "bg-marker text-white" : "text-muted hover:bg-soft hover:text-ink"}`}>
                  {pg.number}
                </button>
              ))}
            </div>
          )}
          <div className="flex rounded-lg bg-soft p-0.5 text-xs font-medium" role="group" aria-label="Source view">
            {([["Word map", false], ["Original", true]] as const).map(([label, v]) => (
              <button key={label} onClick={() => onOriginal(v)} aria-pressed={original === v}
                className={`rounded-md px-3 py-1.5 transition ${original === v ? "bg-card text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="desk scroll-thin flex-1 overflow-auto px-4 py-6 sm:px-8 sm:py-8">
        {!original ? (
          <div className="paper-shadow mx-auto max-w-[560px] rounded-[3px] bg-paper fade" key={`${entry.key}-${p.number}`}>
            <svg viewBox={`0 0 ${p.width} ${p.height}`} className="block h-auto w-full select-none" role="img"
              aria-label={`Word map of page ${p.number}. ${onThisPage.length} charges can be traced.`}>
              <rect width={p.width} height={p.height} fill="var(--paper)" onClick={() => onPick(null)} />
              {hov && <Mark b={hov.bbox} soft />}
              {sel && <Mark b={sel.bbox} key={`sel-${selected}`} />}
              <g className="font-mono" style={{ pointerEvents: "none" }}>
                {p.words.map((w, i) => {
                  const h = w.bbox.y1 - w.bbox.y0;
                  const low = w.confidence < 0.8;
                  return (
                    <text key={i} x={w.bbox.x0} y={w.bbox.y0 + h * 0.82} fontSize={h * 0.86}
                      textLength={Math.max(1, w.bbox.x1 - w.bbox.x0)} lengthAdjust="spacingAndGlyphs"
                      fill={low ? "var(--review)" : "#2c2a24"} fontWeight={low ? 600 : 400}>
                      {w.text}
                    </text>
                  );
                })}
              </g>
              {/* Invisible hit areas so charges can be picked straight from the page */}
              {onThisPage.map(({ l, i }) => (
                <rect key={i} x={l.bbox.x0 - PAD_X} y={l.bbox.y0 - PAD_Y} width={l.bbox.x1 - l.bbox.x0 + PAD_X * 2}
                  height={l.bbox.y1 - l.bbox.y0 + PAD_Y * 2} fill="transparent" className="cursor-pointer"
                  onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} onClick={() => onPick(i)}>
                  <title>{l.description}</title>
                </rect>
              ))}
            </svg>
          </div>
        ) : (
          <Original entry={entry} page={p.number} aspect={p.width / p.height} />
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted sm:px-5">
        <span className="flex items-center gap-2">
          <IconTrace size={14} />
          {original ? "Original file." : sel ? <span>Tracing <strong className="font-medium text-ink">{sel.description}</strong></span> : "Click a charge to find it on the page."}
        </span>
        {!original && selected !== null && (
          <button onClick={() => onPick(null)} className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">Clear</button>
        )}
      </footer>
    </section>
  );
}

function Mark({ b, soft = false }: { b: { x0: number; y0: number; x1: number; y1: number }; soft?: boolean }) {
  return (
    <rect x={b.x0 - PAD_X} y={b.y0 - PAD_Y} width={b.x1 - b.x0 + PAD_X * 2} height={b.y1 - b.y0 + PAD_Y * 2} rx={2.5}
      fill={soft ? "var(--marker-soft)" : "var(--hl)"} opacity={soft ? 0.9 : 0.55}
      className={soft ? "" : "marker-stroke"} style={{ mixBlendMode: "multiply", pointerEvents: "none" }} />
  );
}

function Original({ entry, page, aspect }: { entry: Entry; page: number; aspect: number }) {
  if (!entry.originalUrl || !entry.originalType) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-paper/70 px-6 py-16 text-center">
        <p className="font-serif text-2xl">No original attached</p>
        <p className="max-w-sm text-sm text-muted">This document was uploaded as word JSON, so there is no file to show. Switch to <strong className="font-medium text-ink">Word map</strong> to inspect its text and coordinates.</p>
      </div>
    );
  }
  if (entry.originalType === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, not an optimisable asset
    return <img src={entry.originalUrl} alt={`Original upload: ${entry.extraction.filename}`} className="paper-shadow mx-auto block h-auto max-w-[560px] w-full rounded-[3px] bg-paper fade" />;
  }
  return (
    <iframe key={`${entry.originalUrl}#${page}`} title={`Original PDF: ${entry.extraction.filename}`}
      src={`${entry.originalUrl}#page=${page}&toolbar=0&navpanes=0&view=FitH`}
      className="paper-shadow mx-auto block w-full max-w-[560px] rounded-[3px] bg-paper fade"
      style={{ aspectRatio: String(aspect), minHeight: 420 }} />
  );
}
