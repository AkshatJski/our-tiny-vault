import { Resend } from 'resend';
import { env } from '@/lib/env';
import { formatUnlockMoment } from '@/lib/utils';

/**
 * Resend wrapper.
 *
 * Free tier: 100 emails/day, shared with Supabase auth emails if you point
 * Supabase's SMTP at Resend. We self-cap at 90 (see budget.ts) and the cron
 * enforces it in SQL-counted batches, so a retry storm can never blow the quota.
 *
 * Dry-run behaviour: with no RESEND_API_KEY the sender returns `skipped` instead
 * of throwing. That keeps `next dev` and the cron route usable before you have a
 * verified domain, and it makes the cron report honest about what it did.
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!env.isEmailConfigured) return null;
  if (!client) client = new Resend(env.resendApiKey);
  return client;
}

export interface UnlockEmailArgs {
  to: string;
  displayName: string;
  capsuleTitle: string;
  unlockAt: string;
  partyUrl: string;
  capsuleId: string;
}

export interface SendResult {
  ok: boolean;
  id: string | null;
  skipped?: 'not_configured';
  error?: string;
}

/** Warm, paper-coloured email. Inline styles only — email clients are feral. */
export function renderUnlockEmail(args: UnlockEmailArgs): { subject: string; html: string; text: string } {
  const when = formatUnlockMoment(args.unlockAt);
  const subject = `🕰️ "${args.capsuleTitle}" is open`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FCFBF7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCFBF7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#FFFEFB;border:1px solid #EBE4D4;border-radius:18px;
                    box-shadow:0 12px 30px -18px rgba(74,63,53,.45);font-family:'Trebuchet MS',Verdana,sans-serif;">
        <tr><td style="padding:28px 28px 8px;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#9C9186;">our tiny vault</p>
          <h1 style="margin:0;font-size:24px;line-height:1.25;color:#4A3F35;">Dear ${escapeHtml(args.displayName)},</h1>
        </td></tr>
        <tr><td style="padding:8px 28px 0;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#6E6154;">
            The little capsule you helped fill with <strong style="color:#4A3F35;">${escapeHtml(args.capsuleTitle)}</strong>
            has just come unsealed.
          </p>
          <div style="background:#FCF3CE;border-radius:14px;padding:14px 16px;margin:0 0 18px;">
            <p style="margin:0;font-size:13px;color:#8C6239;letter-spacing:.04em;">opened at</p>
            <p style="margin:4px 0 0;font-size:15px;color:#4A3F35;font-weight:bold;">${escapeHtml(when)}</p>
          </div>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#6E6154;">
            Everyone is meeting in the reading room to unwrap it together. You can pull the string,
            throw a reaction, and scratch off the predictions you all made.
          </p>
        </td></tr>
        <tr><td style="padding:0 28px 30px;">
          <a href="${escapeHtml(args.partyUrl)}"
             style="display:inline-block;background:#F4C7C3;color:#4A3F35;text-decoration:none;
                    font-weight:bold;font-size:15px;padding:13px 22px;border-radius:999px;
                    border:1px solid #D98C86;">join the opening party →</a>
        </td></tr>
        <tr><td style="padding:0 28px 26px;border-top:1px solid #EBE4D4;">
          <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#9C9186;">
            You are getting this because you are a member of this capsule. One email per capsule,
            ever. Not a newsletter, we promise.
          </p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:11px;color:#9C9186;font-family:'Trebuchet MS',Verdana,sans-serif;">
        our tiny vault · capsule ${escapeHtml(args.capsuleId.slice(0, 8))}
      </p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Dear ${args.displayName},`,
    '',
    `"${args.capsuleTitle}" is open. It unlocked at ${when}.`,
    '',
    `Join the opening party: ${args.partyUrl}`,
    '',
    'You are getting this because you are a member of this capsule. One email per capsule, ever.',
  ].join('\n');

  return { subject, html, text };
}

export async function sendUnlockEmail(args: UnlockEmailArgs): Promise<SendResult> {
  const resend = getClient();
  if (!resend) return { ok: false, id: null, skipped: 'not_configured' };

  const { subject, html, text } = renderUnlockEmail(args);

  try {
    const result = await resend.emails.send({
      from: env.resendFrom,
      to: [args.to],
      subject,
      html,
      text,
    });

    if (result.error) {
      return { ok: false, id: null, error: result.error.message };
    }
    return { ok: true, id: result.data?.id ?? null };
  } catch (error) {
    return {
      ok: false,
      id: null,
      error: error instanceof Error ? error.message : 'unknown resend failure',
    };
  }
}

export function isEmailConfigured(): boolean {
  return env.isEmailConfigured;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
