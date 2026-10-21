/**
 * The $0 budget, in one file.
 *
 * Every number here is a free-tier limit, restated as a product rule so that a
 * future change ("just bump the image limit to 20 MB") fails loudly in code
 * review instead of quietly at the end of the month.
 *
 *   Supabase free : 1 GB storage · 500 MB database · 200 concurrent realtime
 *   Resend free   : 100 emails / day (account-owner recipients only, no domain)
 *   Brevo free    : 300 emails / day (any recipient, verified sender address)
 *   Vercel Hobby  : 1 cron run / day (max 2 cron jobs), 60s max function time
 */

/** 5 MB. Storage bucket ceiling AND client-side pre-check. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** What compression aims for. 10x under the ceiling keeps the average tiny. */
export const TARGET_IMAGE_BYTES = 300 * 1024;
/** Longest edge after downscale. A 2026 phone photo is ~4000px; nobody needs that. */
export const MAX_IMAGE_EDGE = 1600;

/** Hard stop for audio. ~1 MB at opus 32 kbps for a minute. */
export const MAX_AUDIO_SECONDS = 60;
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const AUDIO_BITRATE = 32_000;

/** Per-capsule storage. Matches capsules.storage_quota_bytes default. */
export const CAPSULE_QUOTA_BYTES = 60 * 1024 * 1024;
/** Platform ceiling enforced by a DB trigger (900 MB of the free 1 GB). */
export const PLATFORM_CEILING_BYTES = 900 * 1024 * 1024;

/** Realtime presence cap per capsule. DB members cap matches this. */
export const PRESENCE_CAP = 20;
/** Free tiers are 100/day (Resend) and 300/day (Brevo); we stop at 90 so one
 *  retry never overshoots, and the number means the same thing on both. */
export const EMAIL_DAILY_CAP = 90;
/** How long a presence slot is considered live. */
export const PRESENCE_TTL_SECONDS = 180;
/** Party log retention — keeps the 500 MB database flat forever. */
export const REALTIME_EVENT_RETENTION_DAYS = 7;

export const CAPSULE_INVITE_LENGTH = 8;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function storagePercent(used: number, quota: number): number {
  if (!quota) return 0;
  return Math.min(100, Math.max(0, Math.round((used / quota) * 100)));
}

/** Human-readable reason a file was refused. Shown verbatim in the UI. */
export class BudgetError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BudgetError';
    this.code = code;
  }
}
