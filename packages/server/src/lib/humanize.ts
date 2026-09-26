/**
 * Parse counts as they appear on real pages: "1,234" / "1.234" / "1 234" /
 * "1.2K" / "3.4M" / "12K subscribers".
 *
 * The separator cases are genuinely ambiguous across locales, so the digit count
 * after the separator decides: exactly three digits means thousands, otherwise
 * it is a decimal point.
 */
export function parseHumanNumber(input: string): number | null {
  if (!input) return null;
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');

  const match = /(\d[\d\s.,]*)\s*(k|m|b|mil|mn|thousand|million|billion)?/.exec(text);
  if (!match?.[1]) return null;

  let digits = match[1].replace(/\s/g, '');
  let multiplier = 1;

  const suffix = match[2];
  if (suffix) {
    if (suffix === 'k' || suffix === 'thousand') multiplier = 1_000;
    else if (suffix === 'm' || suffix === 'mn' || suffix === 'mil' || suffix === 'million') multiplier = 1_000_000;
    else if (suffix === 'b' || suffix === 'billion') multiplier = 1_000_000_000;
  }

  // Collapse separators. A separator followed by exactly 3 digits is a grouping
  // separator; otherwise it is a decimal point.
  digits = digits.replace(/([.,])(\d{3})(?=\D|$)/g, '$1$2');
  const parts = digits.split(/[.,](?=\d{1,2}$)/);
  const normalized = parts.length > 1 ? `${parts[0]}.${parts[1]}` : digits.replace(/[.,]/g, '');

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * multiplier);
}

/** Compact display form: 12400 -> "12.4K". */
export function formatCompact(value: number | null): string {
  if (value === null || value === undefined) return '—';
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
}
