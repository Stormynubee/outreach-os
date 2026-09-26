/**
 * Formatting helpers. Every one of them accepts `null` / `undefined` / `NaN`
 * and returns a muted placeholder instead of throwing — the UI must never crash
 * because the backend omitted a field.
 */

const NUMBER = new Intl.NumberFormat('en-US');
const MUTED = '—';

export function formatNumber(value: number | null | undefined, fallback = '0'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return NUMBER.format(Math.round(value));
}

/** 1234 -> "1.2k", 24000 -> "24k". Used for follower counts. */
export function formatCompact(value: number | null | undefined, fallback = MUTED): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const abs = Math.abs(value);
  if (abs < 1000) return NUMBER.format(Math.round(value));
  if (abs < 1_000_000) {
    const k = value / 1000;
    return `${abs >= 10_000 ? Math.round(k) : Number(k.toFixed(1))}k`;
  }
  const m = value / 1_000_000;
  return `${abs >= 10_000_000 ? Math.round(m) : Number(m.toFixed(1))}m`;
}

/** 0.42 -> "42%" */
export function formatPercent(ratio: number | null | undefined, digits = 0, fallback = MUTED): string {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return fallback;
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 13 -> "+13%", -4 -> "−4%", null -> null (caller renders a muted dash). */
export function formatSignedPercent(value: number | null | undefined, digits = 0): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0%';
  return rounded > 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`;
}

const RELATIVE_STEPS: Array<{ limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 3600, divisor: 60, unit: 'minute' },
  { limit: 86_400, divisor: 3600, unit: 'hour' },
  { limit: 604_800, divisor: 86_400, unit: 'day' },
  { limit: 2_592_000, divisor: 604_800, unit: 'week' },
  { limit: 31_536_000, divisor: 2_592_000, unit: 'month' },
  { limit: Number.POSITIVE_INFINITY, divisor: 31_536_000, unit: 'year' },
];

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Accepts an epoch-ms number or an ISO string. */
export function relativeTime(value: number | string | null | undefined, fallback = MUTED): string {
  const ms = toMillis(value);
  if (ms === null) return fallback;
  const seconds = Math.round((ms - Date.now()) / 1000);
  const magnitude = Math.abs(seconds);
  for (const step of RELATIVE_STEPS) {
    if (magnitude < step.limit) {
      return RELATIVE.format(Math.round(seconds / step.divisor), step.unit);
    }
  }
  return fallback;
}

export function formatDate(value: number | string | null | undefined, fallback = MUTED): string {
  const ms = toMillis(value);
  if (ms === null) return fallback;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(ms);
}

export function formatDayMonth(value: number | string | null | undefined, fallback = MUTED): string {
  const ms = toMillis(value);
  if (ms === null) return fallback;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(ms);
}

/** ISO calendar day (local) — the shape the API expects for `?date=`. */
export function isoDay(date: Date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return isoDay(new Date());
}

export function addDaysISO(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

/** 0 = Monday … 6 = Sunday, matching the Mon-first chart. */
export function mondayIndex(date: Date = new Date()): number {
  return (date.getDay() + 6) % 7;
}

export function daysBetween(isoDateA: string, isoDateB: string): number | null {
  const a = Date.parse(`${isoDateA}T00:00:00`);
  const b = Date.parse(`${isoDateB}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export function formatDuration(seconds: number | null | undefined, fallback = MUTED): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return fallback;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Number((seconds / 3600).toFixed(1))} h`;
  return `${Number((seconds / 86_400).toFixed(1))} d`;
}

export function formatBytes(bytes: number | null | undefined, fallback = MUTED): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return fallback;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(1))} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

export function formatMs(ms: number | null | undefined, fallback = MUTED): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return fallback;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${Number((ms / 1000).toFixed(1))} s`;
}

/** "https://www.example.com/path" -> "example.com" */
export function hostFromUrl(url: string | null | undefined, fallback = MUTED): string {
  if (!url) return fallback;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || fallback;
  }
}

/** Trim a URL for display without losing the fact that it is a URL. */
export function prettyUrl(url: string | null | undefined, fallback = MUTED): string {
  if (!url) return fallback;
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  const safe = Number.isFinite(count) ? count : 0;
  return `${safe} ${safe === 1 ? singular : pluralForm ?? `${singular}s`}`;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function percentOf(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return clamp01(value / max);
}

function toMillis(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    // Bare "YYYY-MM-DD" is parsed as UTC midnight by Date.parse — treat it as local.
    const iso = Date.parse(`${value}T00:00:00`);
    return Number.isFinite(iso) ? iso : null;
  }
  return null;
}
