// Money is stored and computed as integer cents (USD). Parsing works on the
// string form so values like "0.1" never pass through binary floats.

export const MAX_ENTRY_CENTS = 100_000_000; // $1,000,000 per entry
export const DEFAULT_TARGET_CENTS = 50_000; // $500

export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? '').padEnd(2, '0'));
  const cents = whole * 100 + frac;
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCents(cents: number, opts: { forceDecimals?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const hasFraction = abs % 100 !== 0;
  const digits = opts.forceDecimals || hasFraction ? 2 : 0;
  const str = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(abs / 100);
  return negative ? `−${str}` : str;
}

export function centsToInput(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

export interface ProgressFigures {
  recordedCents: number;
  targetCents: number;
  /** Floored, so 99.6% never reads as 100%. May exceed 100. */
  percent: number;
  remainingCents: number;
  overCents: number;
  achieved: boolean;
  /** 0–1, capped at 1 for the visual bar. */
  barRatio: number;
}

export function progressFigures(recordedCents: number, targetCents: number): ProgressFigures {
  const safeTarget = Math.max(targetCents, 1);
  const percent = Math.floor((Math.max(recordedCents, 0) * 100) / safeTarget);
  const achieved = recordedCents >= targetCents;
  return {
    recordedCents,
    targetCents,
    percent,
    remainingCents: Math.max(targetCents - recordedCents, 0),
    overCents: Math.max(recordedCents - targetCents, 0),
    achieved,
    barRatio: Math.min(Math.max(recordedCents, 0) / safeTarget, 1),
  };
}
