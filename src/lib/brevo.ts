import { env } from '@/lib/env';
import {
  renderUnlockEmail,
  type SendResult,
  type UnlockEmailArgs,
} from '@/lib/resend';

/**
 * Brevo transactional sender.
 *
 * Why this exists: Resend's free tier will only deliver to the address that owns
 * the Resend account until you verify a domain. That makes it useless for a
 * capsule with other people in it. Brevo's free tier (300/day, no card) will
 * deliver to anyone from a *verified sender address* — no domain needed.
 *
 * The tradeoff is real and worth writing down: free mailbox domains (gmail.com
 * and friends) cannot carry DKIM, so Brevo rewrites the From address to a
 * shared compliant domain (`…@t-sender-sib.com`) at delivery time. It arrives,
 * but it looks unfamiliar. The fix, when there is money, is a ~$10/year domain
 * and Resend — which is why the Resend path is still fully wired underneath.
 *
 * The template lives in resend.ts and is shared verbatim, so both providers
 * always send the same letter. Only the transport differs.
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
/** A hung provider must not eat the cron's 60s budget. */
const TIMEOUT_MS = 10_000;

export function isBrevoReady(): boolean {
  return env.brevoApiKey.length > 0 && env.brevoFrom.length > 0;
}

export async function sendViaBrevo(args: UnlockEmailArgs): Promise<SendResult> {
  if (!isBrevoReady()) return { ok: false, id: null, skipped: 'not_configured' };

  const { subject, html, text } = renderUnlockEmail(args);

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': env.brevoApiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: env.brevoFromName, email: env.brevoFrom },
        // One recipient per request on purpose: a shared `to` list would leak
        // every member's address to every other member.
        to: [{ email: args.to, name: args.displayName }],
        subject,
        htmlContent: html,
        textContent: text,
        tags: ['vault-opened'],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body = await readJson(response);

    if (!response.ok) {
      return {
        ok: false,
        id: null,
        error: `brevo ${response.status}: ${describeError(body)}`,
      };
    }

    // Brevo answers 201 with { messageId: "<...@smtp-relay.mailin.fr>" }.
    // A missing id is not a failure — the mail is already queued on their side.
    const id = typeof body?.messageId === 'string' ? body.messageId : null;
    return { ok: true, id };
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { ok: false, id: null, error: `brevo timed out after ${TIMEOUT_MS / 1000}s` };
    }
    return {
      ok: false,
      id: null,
      error: error instanceof Error ? error.message : 'unknown brevo failure',
    };
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    // Some gateway errors come back as plain text or HTML. Keep the shape uniform.
    return { message: text.slice(0, 300) };
  }
}

function describeError(body: Record<string, unknown> | null): string {
  if (!body) return 'no response body';
  const message = typeof body.message === 'string' ? body.message : null;
  const code = typeof body.code === 'string' ? body.code : null;
  if (message && code) return `${code} — ${message}`;
  return message ?? code ?? 'unrecognised error';
}
