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
  return env.brevoApiKey.length > 0 && env.brevoFromEmail.length > 0;
}

export interface BrevoMessage {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
  /** Groups messages in the Brevo dashboard, so auth mail and vault mail stay apart. */
  tag: string;
}

/**
 * The one place a Brevo HTTP request is made.
 *
 * Two callers now: the cron's unlock letters, and Supabase's sign-in emails
 * (delivered through the Send Email hook). They differ only in content, so the
 * transport — headers, timeout, error shaping, the reply-to and the tracking
 * decision — lives here once.
 */
export async function sendBrevoMessage(message: BrevoMessage): Promise<SendResult> {
  if (!isBrevoReady()) return { ok: false, id: null, skipped: 'not_configured' };

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': env.brevoApiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: env.brevoFromName, email: env.brevoFromEmail },
        // One recipient per request on purpose: a shared `to` list would leak
        // every member's address to every other member.
        to: [{ email: message.to.email, name: message.to.name }],
        // The sender address is rewritten to a shared Brevo domain (gmail.com
        // cannot carry DKIM), so a reply would otherwise vanish into a relay
        // nobody reads. This puts the human back on the other end.
        replyTo: { email: env.brevoFromEmail, name: env.brevoFromName },
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        tags: [message.tag],
        // Off, deliberately. Click tracking rewrites every link through
        // `sendibt3.com`, which (a) looks like phishing to a cautious reader,
        // (b) is a deliverability signal Gmail scores against, and (c) means a
        // third party logs who opened a private vault. The open pixel is the
        // same trade with less benefit: we care that it arrives, not that it was
        // read. If deliverability is ever diagnosed again, turn opens back on
        // temporarily rather than leaving a tracker in a memory vault.
        trackClicks: false,
        trackOpens: false,
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

export async function sendViaBrevo(args: UnlockEmailArgs): Promise<SendResult> {
  if (!isBrevoReady()) return { ok: false, id: null, skipped: 'not_configured' };

  const { subject, html, text } = renderUnlockEmail(args);

  return sendBrevoMessage({
    to: { email: args.to, name: args.displayName },
    subject,
    html,
    text,
    tag: 'vault-opened',
  });
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
