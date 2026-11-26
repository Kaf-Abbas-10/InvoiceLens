"use client";

import { useRef, useState } from "react";
import type { Entry, Extraction } from "@/lib/types";
import { CHECK_NAMES, money } from "@/lib/format";
import { IconAlert, IconCheck, IconMinus } from "./Icons";

type Props = {
  entry: Entry;
  selected: number | null;
  hovered: number | null;
  onPick: (i: number | null) => void;
  onHover: (i: number | null) => void;
};

export default function Ledger({ entry, selected, hovered, onPick, onHover }: Props) {
  const [tab, setTab] = useState<"overview" | "json">("overview");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const r = entry.extraction;
  const cur = r.currency;

  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? "overview" : e.key === "End" ? "json" : tab === "overview" ? "json" : "overview";
    setTab(next);
    tabs.current[next === "overview" ? 0 : 1]?.focus();
  };

  return (
    <section aria-label="Extracted data" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line-strong/70 bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 sm:px-5">
        <div role="tablist" aria-label="Extraction view" className="flex gap-5" onKeyDown={onKey}>
          {(["overview", "json"] as const).map((t, i) => (
            <button key={t} ref={(el) => { tabs.current[i] = el; }} role="tab" id={`tab-${t}`} aria-selected={tab === t}
              aria-controls={`panel-${t}`} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}
              className={`relative py-3.5 text-sm font-medium transition ${tab === t ? "text-ink" : "text-muted hover:text-ink"}`}>
              {t === "overview" ? "Ledger" : "Raw JSON"}
              {tab === t && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-marker" />}
            </button>
          ))}
        </div>
        <span className="rounded-full border border-line px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[.14em] text-muted">Rule-based</span>
      </header>

      {tab === "overview" ? (
        <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" className="fade">
          <dl className="grid grid-cols-2 gap-px bg-line">
            {([["Vendor", r.vendor], ["Invoice no.", r.invoice_number], ["Date", r.date], ["Currency", r.currency]] as const).map(([k, v]) => (
              <div key={k} className="bg-card px-4 py-3.5 sm:px-5">
                <dt className="text-[11px] font-medium uppercase tracking-[.12em] text-faint">{k}</dt>
                <dd className={`mt-1 truncate text-[15px] ${v ? "font-medium text-ink" : "text-review"}`} title={v ?? undefined}>
                  {v ?? <span className="inline-flex items-center gap-1.5"><IconAlert size={14} />Needs review</span>}
                </dd>
              </div>
            ))}
          </dl>

          <div className="border-t border-line px-4 pb-1 pt-5 sm:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-serif text-[22px] leading-none">Charges <span className="num font-sans text-sm text-faint">{r.line_items.length}</span></h3>
              <span className="text-xs text-faint">Click to locate</span>
            </div>
          </div>
          <div className="scroll-thin overflow-x-auto px-2 sm:px-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[.1em] text-faint">
                  <th className="px-2 py-2.5 font-medium">Description</th>
                  <th className="px-2 py-2.5 text-right font-medium">Qty</th>
                  <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Unit</th>
                  <th className="px-2 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.line_items.map((l, i) => {
                  const on = selected === i;
                  return (
                    <tr key={i} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} onClick={() => onPick(on ? null : i)}
                      className={`cursor-pointer border-t border-line/70 transition-colors ${on ? "bg-marker-soft" : hovered === i ? "bg-marker-soft/50" : "hover:bg-soft/70"}`}>
                      <td className="px-2 py-2.5 align-top">
                        <button onClick={(e) => { e.stopPropagation(); onPick(on ? null : i); }} aria-pressed={on}
                          aria-label={`Trace ${l.description} on page ${l.page}`}
                          className="text-left font-medium text-ink">
                          {l.description}
                        </button>
                        {(l.confidence < 0.8 || l.section || r.page_count > 1) && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {l.confidence < 0.8 && <Tag tone="review">Check OCR · {Math.round(l.confidence * 100)}%</Tag>}
                            {l.section && <Tag>{l.section}</Tag>}
                            {r.page_count > 1 && <Tag>Page {l.page}</Tag>}
                          </div>
                        )}
                      </td>
                      <td className="num px-2 py-2.5 text-right align-top text-muted">{l.quantity === null ? "—" : Number(l.quantity).toLocaleString()}</td>
                      <td className="num hidden px-2 py-2.5 text-right align-top text-muted sm:table-cell">{money(l.unit_price, cur)}</td>
                      <td className={`num px-2 py-2.5 text-right align-top font-medium ${Number(l.amount) < 0 ? "text-pass" : ""}`}>{money(l.amount, cur)}</td>
                    </tr>
                  );
                })}
                {!r.line_items.length && (
                  <tr><td colSpan={4} className="px-2 py-8 text-center text-muted">No charge rows were found. Check the source document.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <Totals r={r} />
          <Checks r={r} />
          <Notes r={r} />
          <Confidence value={r.confidence} />
        </div>
      ) : (
        <div id="panel-json" role="tabpanel" aria-labelledby="tab-json" className="fade">
          <pre className="scroll-thin max-h-[760px] overflow-auto bg-soft px-5 py-4 font-mono text-[12px] leading-relaxed text-ink">
            <JsonCode value={r} />
          </pre>
        </div>
      )}
    </section>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "review" }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${tone === "review" ? "bg-review-soft text-review" : "bg-soft text-muted"}`}>{children}</span>
  );
}

function Totals({ r }: { r: Extraction }) {
  const rows = ([["Subtotal", "subtotal"], ["Tax", "tax"], ["Shipping", "shipping"], ["Discount", "discount"]] as const)
    .filter(([, k]) => k === "subtotal" || r[k] !== null);
  return (
    <div className="mt-2 border-t border-line px-4 py-4 sm:px-5">
      <div className="ml-auto max-w-[300px] space-y-1.5 text-sm">
        {rows.map(([label, k]) => (
          <div key={k} className="flex justify-between gap-6 text-muted">
            <span>{label}</span>
            <span className="num text-ink-2">{k === "discount" ? "− " : ""}{money(r[k], r.currency)}</span>
          </div>
        ))}
        <div className="!mt-3 flex items-baseline justify-between gap-6 border-t-2 border-ink pt-3">
          <span className="font-serif text-xl">Total</span>
          <span className="num text-xl font-semibold tracking-tight">{money(r.total, r.currency)}</span>
        </div>
      </div>
    </div>
  );
}

function Checks({ r }: { r: Extraction }) {
  if (!r.checks.length) return null;
  const pass = r.checks.filter((c) => c.status === "pass").length;
  return (
    <div className="border-t border-line px-4 py-5 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-[22px] leading-none">Reconciliation</h3>
        <span className="num text-xs text-faint">{pass}/{r.checks.length} passed</span>
      </div>
      <ul className="mt-3 divide-y divide-line/70">
        {r.checks.map((c, i) => {
          const tone = c.status === "pass" ? "text-pass bg-pass-soft" : c.status === "fail" ? "text-fail bg-fail-soft" : "text-muted bg-soft";
          return (
            <li key={i} className="flex items-start gap-3 py-2.5" title={c.detail}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone}`}>
                {c.status === "pass" ? <IconCheck size={14} /> : c.status === "fail" ? <IconAlert size={13} /> : <IconMinus size={13} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{CHECK_NAMES[c.name] ?? c.name}</p>
                <p className="num text-xs text-muted">
                  {c.status === "unavailable" ? "A required amount was not found."
                    : <>{money(c.expected, r.currency)} expected · {money(c.actual, r.currency)} found{c.status === "fail" && <strong className="font-semibold text-fail"> · {money(c.difference, r.currency)} off</strong>}</>}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
                {{ pass: "Passed", fail: "Mismatch", unavailable: "Not checked" }[c.status]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Review notes: plain list, same style as the checks. Maths mismatches are already shown above. */
function Notes({ r }: { r: Extraction }) {
  const notes = r.flags.filter((f) => f.code !== "math_mismatch");
  if (!notes.length) return null;
  return (
    <div className="border-t border-line px-4 py-5 sm:px-5">
      <h3 className="font-serif text-[22px] leading-none">To check</h3>
      <ul className="mt-3 divide-y divide-line/70">
        {notes.map((f, i) => (
          <li key={i} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-soft text-muted"><IconAlert size={13} /></span>
            <p className="min-w-0 flex-1 text-sm text-ink-2">{f.message}</p>
            {f.page && <span className="shrink-0 text-xs text-faint">Page {f.page}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 90 ? "bg-pass" : pct >= 70 ? "bg-marker" : "bg-review";
  return (
    <div className="border-t border-line px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-ink-2" title="A rule-based score, not a guarantee. Review before accounting use.">Confidence</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Rule confidence">
          <div className={`h-full rounded-full ${tone} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
        </div>
        <span className="num text-xs font-semibold">{pct}%</span>
      </div>
    </div>
  );
}

/** Pretty JSON with light syntax colouring. */
function JsonCode({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const parts: React.ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      parts.push(<span key={k++} className={m[2] ? "text-muted" : "text-[#4338ca]"}>{m[1]}</span>);
      if (m[2]) parts.push(m[2]);
    } else if (m[3]) parts.push(<span key={k++} className="text-[#b45309]">{m[3]}</span>);
    else parts.push(<span key={k++} className="text-[#15803d]">{m[4]}</span>);
    last = re.lastIndex;
  }
  parts.push(text.slice(last));
  return <code>{parts}</code>;
}
