import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verification for Supabase's Send Email hook, which follows the Standard
 * Webhooks spec (https://www.standardwebhooks.com).
 *
 * The endpoint that uses this is public — it has to be, because Supabase Auth
 * calls it from the outside. Without a signature check it would be an open relay:
 * anyone could post an address and make this app send mail from your verified
 * Brevo sender. That is how a hobby project loses its sending privileges.
 *
 * THE SPEC, IN FIVE LINES
 *
 *   headers:  webhook-id, webhook-timestamp, webhook-signature
 *   signed:   `${id}.${timestamp}.${rawBody}`      ← raw bytes, not re-serialised JSON
 *   secret:   `v1,whsec_<base64>` (Supabase) → strip to the base64 part
 *   header:   `v1,<base64 hmac-sha256>` (space-separated when several are sent)
 *   guard:    reject old timestamps, so a captured request cannot be replayed
 *
 * The subtlety that breaks most implementations: it must be the *raw* body. If
 * you `JSON.parse` first and stringify again, key order and spacing can change
 * and the signature will never match.
 */

const TOLERANCE_SECONDS = 5 * 60;

export interface VerifyInput {
  rawBody: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  /** Injectable for tests; defaults to now. */
  nowSeconds?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyWebhookSignature(input: VerifyInput): VerifyResult {
  const { rawBody, id, timestamp, signature, secret } = input;

  if (!secret) return { ok: false, reason: 'hook secret is not configured' };
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing signature headers' };

  const sentAt = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'timestamp is not a number' };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - sentAt) > TOLERANCE_SECONDS) {
    return { ok: false, reason: `timestamp outside the ${TOLERANCE_SECONDS}s window` };
  }

  const key = decodeSecret(secret);
  if (!key) return { ok: false, reason: 'secret is not valid base64' };

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();

  // Several signatures may be present during a secret rotation.
  const candidates = signature
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [version, value] = part.split(',', 2);
      return version === 'v1' && value ? value : null;
    })
    .filter((value): value is string => Boolean(value));

  if (candidates.length === 0) return { ok: false, reason: 'no v1 signature present' };

  for (const candidate of candidates) {
    const provided = Buffer.from(candidate, 'base64');
    // timingSafeEqual throws on length mismatch, so check that first. Length is
    // not secret — it is always the digest size.
    if (provided.length !== expected.length) continue;
    if (timingSafeEqual(provided, expected)) return { ok: true };
  }

  return { ok: false, reason: 'signature mismatch' };
}

/**
 * Supabase hands out `v1,whsec_<base64>`. Some tooling hands out just
 * `whsec_<base64>`, and the raw base64 also shows up in examples, so accept all
 * three rather than making the deploy depend on punctuation.
 */
function decodeSecret(secret: string): Buffer | null {
  let value = secret.trim();
  if (value.startsWith('v1,')) value = value.slice(3);
  if (value.startsWith('whsec_')) value = value.slice('whsec_'.length);

  const buffer = Buffer.from(value, 'base64');
  if (buffer.length === 0) return null;

  // Buffer.from is forgiving: it silently drops invalid characters. Re-encoding
  // and comparing catches "not actually base64" instead of producing a key that
  // can never match.
  return buffer.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
    ? buffer
    : Buffer.from(value, 'utf8');
}
