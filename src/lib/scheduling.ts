export type SchedulingResult = { ok: true; instant: Date } | { ok: false; error: string };

function fieldsAt(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

export function resolveLocalDateTime(date: string, time: string, timeZone: string): SchedulingResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: "Invalid date or time format." };
  const [year, month, day] = date.split("-").map(Number); const [hour, minute] = time.split(":").map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return { ok: false, error: "Invalid date or time." };
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return { ok: false, error: "Invalid calendar date." };
  try { new Intl.DateTimeFormat("en-GB", { timeZone }).format(); } catch { return { ok: false, error: "Invalid IANA timezone." }; }
  const wall = calendar.getTime(); const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 3) { const sample = new Date(wall + delta * 60 * 60 * 1000); const f = fieldsAt(sample, timeZone); offsets.add(Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute) - sample.getTime()); }
  const matches = [...offsets].map((offset) => new Date(wall - offset)).filter((candidate) => { const f = fieldsAt(candidate, timeZone); return f.year === year && f.month === month && f.day === day && f.hour === hour && f.minute === minute; });
  if (matches.length === 0) return { ok: false, error: "That local time does not exist in the selected timezone." };
  if (matches.length > 1) return { ok: false, error: "That local time is ambiguous in the selected timezone." };
  return { ok: true, instant: matches[0] };
}

export function futureDateTime(date: string, time: string, timeZone: string, now = Date.now()) { const result = resolveLocalDateTime(date, time, timeZone); return result.ok && result.instant.getTime() > now; }
