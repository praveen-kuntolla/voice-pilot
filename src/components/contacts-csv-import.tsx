"use client";
import { useMemo, useRef, useState } from "react";
import { markExistingDuplicates, normalizeEmail, normalizePhone, parseCsvText, summarizeCsv, validateCsvRows, MAX_CSV_BYTES, MAX_CSV_ROWS, type CsvRow } from "@/lib/csv";

type ExistingContact = { email?: string; phone?: string };
type Outcome = "Imported" | "Already exists" | "Invalid" | "Failed" | "Needs verification";
type RowOutcome = Record<number, Outcome>;

export function ContactsCsvImport({ existing, onImported }: { existing: ExistingContact[]; onImported: () => void }) {
  const [rows, setRows] = useState<CsvRow[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [summary, setSummary] = useState<string | null>(null), [outcomes, setOutcomes] = useState<RowOutcome>({});
  const cancelled = useRef(false);
  const stats = useMemo(() => summarizeCsv(rows), [rows]);
  const isDuplicate = (row: CsvRow, contacts: ExistingContact[]) => contacts.some((contact) => (row.email && contact.email && normalizeEmail(row.email) === normalizeEmail(contact.email)) || (row.phone && contact.phone && normalizePhone(row.phone) === normalizePhone(contact.phone)));
  const isImportable = (row: CsvRow) => !row.errors.length && !row.warnings.some((warning) => warning.includes("already exists") || warning.includes("duplicate"));
  async function choose(file?: File) { setSummary(null); setOutcomes({}); setError(""); if (!file) { setRows([]); return; } if (file.size > MAX_CSV_BYTES) { setError("CSV exceeds the 5 MB limit."); setRows([]); return; } const parsed = parseCsvText(await file.text()); setError(parsed.error); setRows(parsed.error ? [] : markExistingDuplicates(validateCsvRows(parsed.records), existing)); }
  async function importRows() {
    const valid = rows.filter(isImportable); if (!valid.length) { setError("No new valid rows are ready to import."); return; }
    setBusy(true); setError(""); setSummary(null); cancelled.current = false;
    let contacts: ExistingContact[];
    try { const response = await fetch("/api/contacts"); if (!response.ok) throw new Error("refresh failed"); contacts = (await response.json()).contacts || []; }
    catch { setError("Could not refresh contacts before import. No rows were written."); setBusy(false); return; }
    const next: RowOutcome = {};
    for (const row of valid) {
      if (cancelled.current) { next[row.rowNumber] = "Failed"; continue; }
      if (isDuplicate(row, contacts)) { next[row.rowNumber] = "Already exists"; continue; }
      try {
        const response = await fetch("/api/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: row.name, email: row.email || undefined, phone: row.phone || undefined, consent_status: "unknown" }) });
        if (response.ok) { next[row.rowNumber] = "Imported"; const created = (await response.json()).contact; contacts = [...contacts, { email: created?.email, phone: created?.phone }]; }
        else if (response.status === 409) next[row.rowNumber] = "Already exists";
        else next[row.rowNumber] = "Failed";
      } catch { next[row.rowNumber] = "Needs verification"; break; }
    }
    for (const row of rows) if (!next[row.rowNumber]) next[row.rowNumber] = row.errors.length ? "Invalid" : "Already exists";
    setOutcomes(next); const counts = Object.values(next).reduce<Record<string, number>>((all, outcome) => ({ ...all, [outcome]: (all[outcome] || 0) + 1 }), {});
    setSummary(`Imported ${counts.Imported || 0}; already exists ${counts["Already exists"] || 0}; invalid ${counts.Invalid || 0}; failed ${counts.Failed || 0}; needs verification ${counts["Needs verification"] || 0}.`); setBusy(false); if (counts.Imported) onImported();
  }
  function cancel() { cancelled.current = true; setSummary("Cancellation requested. Completed writes remain; no rollback is implied."); }
  return <section className="card" aria-label="Contacts CSV import" style={{ marginTop: 18 }}><div className="eyebrow">Bounded import · preparation only</div><h2>Import contacts from CSV</h2><p className="muted">Imports use the tenant-authorized contact API. Consent always starts as unknown; CSV claims are not verification evidence.</p><label className="label" htmlFor="contacts-csv-file">Choose CSV file<input id="contacts-csv-file" className="input" type="file" accept=".csv,text/csv" onChange={(event) => void choose(event.target.files?.[0])} /></label>{error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}{rows.length > 0 && <><div className="grid"><div><span className="muted">Rows</span><strong>{stats.total}</strong></div><div><span className="muted">Valid new</span><strong>{rows.filter(isImportable).length}</strong></div><div><span className="muted">Invalid</span><strong>{stats.invalid}</strong></div><div><span className="muted">Duplicates</span><strong>{stats.duplicateEmails + stats.duplicatePhones}</strong></div></div><p className="notice">No automatic campaign enrollment occurs. Reconciliation refreshes authorized contacts before writes and never retries an uncertain request.</p><div style={{ overflowX: "auto" }}><table className="table"><thead><tr><th>Row</th><th>Name</th><th>Consent claim</th><th>Validation</th><th>Outcome</th></tr></thead><tbody>{rows.slice(0, MAX_CSV_ROWS).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.name || "—"}</td><td>{row.consent_status || "unknown"}</td><td>{[...row.errors, ...row.warnings].join(", ") || "Ready"}</td><td>{outcomes[row.rowNumber] || "Pending"}</td></tr>)}</tbody></table></div><button className="btn primary" type="button" disabled={busy} onClick={() => void importRows()}>{busy ? "Importing…" : "Confirm import"}</button><button className="btn ghost" type="button" disabled={!busy} onClick={cancel}>Cancel import</button></>}{summary && <p className="notice" role="status">{summary}</p>}</section>;
}
