/** Tiny classname joiner. No clsx dependency for six lines of work. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Deterministic 0..1 from a string — keeps card rotations stable across renders. */
export function seededUnit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

export function rotationFor(seed: string, spread = 2.4): number {
  return (seededUnit(seed) * 2 - 1) * spread;
}

export interface CountdownParts {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  unlocked: boolean;
}

export function countdownTo(targetIso: string, now: number = Date.now()): CountdownParts {
  const target = new Date(targetIso).getTime();
  const diff = target - now;
  if (!Number.isFinite(target)) {
    return { totalMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0, unlocked: true };
  }
  const totalMs = Math.max(0, diff);
  const seconds = Math.floor(totalMs / 1000);
  return {
    totalMs,
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
    unlocked: diff <= 0,
  };
}

export function formatUnlockDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatUnlockMoment(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(Math.round(diff / 1000), 'second');
}

export function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Somewhere for the guest to look. Never decides authorization. */
export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/capacity:/.test(raw)) return raw.replace(/^capacity:\s*/, '');
  if (/budget:/.test(raw)) return raw.replace(/^budget:\s*/, '');
  if (/invite:/.test(raw)) return raw.replace(/^invite:\s*/, '');
  if (/promise:/.test(raw)) return raw.replace(/^promise:\s*/, '');
  if (/sealed:/.test(raw)) return raw.replace(/^sealed:\s*/, '');
  if (/guess:/.test(raw)) return raw.replace(/^guess:\s*/, '');
  if (/duplicate key/i.test(raw)) return 'That is already saved.';
  if (/JWT|session|token/i.test(raw)) return 'Your session expired. Please sign in again.';
  if (/row-level security|42501/i.test(raw)) return 'That door is locked right now.';
  return raw || 'Something went sideways. Try again in a moment.';
}
