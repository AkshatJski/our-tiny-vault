import { env } from '@/lib/env';
import { sendBrevoMessage } from '@/lib/brevo';
import type { SendResult } from '@/lib/resend';

/**
 * Sign-in emails, sent by us instead of by Supabase.
 *
 * WHY THIS EXISTS
 *
 * Supabase's built-in mailer is deliberately crippled: 2 messages an hour for
 * the whole project, and — since September 2024 — delivery only to addresses
 * that belong to the project's own team. For an app you hand to friends, that
 * means nobody outside your team can ever sign in.
 *
 * The obvious fix is custom SMTP, and we tried it: the settings saved cleanly,
 * the credentials were proven correct from a laptop (AUTH LOGIN and AUTH PLAIN,
 * both ports, a full message accepted with `250 OK: queued`), and Supabase still
 * answered `500 Error sending magic link email` on every attempt. Their handover
 * to Brevo fails for reasons invisible from outside.
 *
 * So Supabase no longer hands over anything. With the **Send Email hook**
 * enabled, Auth calls this app with the token and expects us to deliver it. We
 * post to Brevo's HTTP API instead — the exact transport the vault's own
 * notification emails have been using successfully all along.
 *
 * TRADEOFFS ACCEPTED
 *
 *   • One more public endpoint to secure. It verifies Supabase's signature
 *     (see lib/hook-signature.ts) and refuses everything unsigned.
 *   • Auth email volume now shares Brevo's 300/day with the vault letters.
 *     Both are tiny; the daily cap on the *queue* is unchanged.
 *   • If Brevo is down, sign-in is down. That was already true of the vault
 *     letters, and the rollback is one toggle: turn the hook off and Supabase's
 *     built-in mailer takes over again.
 */

/** What Supabase Auth can ask us to send. */
export type AuthAction = 'signup' | 'magiclink' | 'recovery' | 'invite' | 'email_change';

const SUBJECTS: Record<AuthAction, string> = {
  magiclink: 'your way in · our tiny vault',
  signup: 'one tap to finish · our tiny vault',
  recovery: 'a new key · our tiny vault',
  invite: 'you are invited · our tiny vault',
  email_change: 'confirm your new address · our tiny vault',
};

const HEADLINES: Record<AuthAction, string> = {
  magiclink: 'come in',
  signup: 'almost there',
  recovery: 'let’s get you back in',
  invite: 'you are invited',
  email_change: 'new address, same vault',
};

const BLURBS: Record<AuthAction, string> = {
  magiclink: 'Tap the button and the door opens. The link works once and expires in an hour.',
  signup: 'Tap the button to finish setting up your corner of the vault. The link works once and expires in an hour.',
  recovery: 'Tap the button to choose a new password. The link works once and expires in an hour.',
  invite: 'Someone saved you a place. Tap the button to step inside. The link works once and expires in an hour.',
  email_change: 'Tap the button to confirm this is your new address. The link works once and expires in an hour.',
};

/** Anything Supabase sends that we do not recognise is treated as a sign-in. */
export function normalizeAction(value: string | undefined): AuthAction {
  const known: AuthAction[] = ['signup', 'magiclink', 'recovery', 'invite', 'email_change'];
  return known.includes(value as AuthAction) ? (value as AuthAction) : 'magiclink';
}

export function renderAuthEmail(args: {
  action: AuthAction;
  actionUrl: string;
}): { subject: string; html: string; text: string } {
  const { action, actionUrl } = args;
  const subject = SUBJECTS[action];

  // Inline styles only: email clients strip <style> blocks and class names, so
  // the paper look has to travel with each element.
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3ece0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ece0;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#fdfaf3;border:1px solid #e6dbc6;border-radius:20px;padding:34px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3f362c;">
            <tr>
              <td style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#a3937c;padding-bottom:18px;">
                our tiny vault
              </td>
            </tr>
            <tr>
              <td style="font-size:26px;font-weight:700;line-height:1.2;padding-bottom:10px;">
                ${escapeHtml(HEADLINES[action])}
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.65;color:#5c5145;padding-bottom:26px;">
                ${escapeHtml(BLURBS[action])}
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:26px;">
                <a href="${escapeHtml(actionUrl)}"
                   style="display:inline-block;background:#e8b96a;color:#3f362c;text-decoration:none;font-size:16px;font-weight:700;padding:14px 26px;border-radius:999px;border:1px solid #d9a855;">
                  open the door
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:1.6;color:#8b7d6b;border-top:1px dashed #e0d4bf;padding-top:18px;">
                If the button does nothing, paste this into your browser:<br>
                <span style="color:#6b5f50;word-break:break-all;">${escapeHtml(actionUrl)}</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:1.6;color:#a3937c;padding-top:16px;">
                Did not ask for this? You can ignore it — nothing changes and the link expires on its own.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    'our tiny vault',
    '',
    HEADLINES[action],
    '',
    BLURBS[action],
    '',
    actionUrl,
    '',
    'Did not ask for this? Ignore it — nothing changes and the link expires on its own.',
  ].join('\n');

  return { subject, html, text };
}

/**
 * Build the URL the user clicks.
 *
 * Supabase hands us a `token_hash`, not a full link, so the destination is ours
 * to assemble — which is exactly why the app's existing `/auth/callback` keeps
 * working untouched: it already verifies `token_hash` + `type` via `verifyOtp`.
 */
export function buildActionUrl(args: {
  tokenHash: string;
  action: AuthAction;
  /** Where Supabase says they should land; may be absent for admin-generated mail. */
  redirectTo?: string;
  siteUrl?: string;
}): string {
  const siteUrl = (args.siteUrl ?? env.siteUrl).replace(/\/+$/, '');
  const next = nextPathFrom(args.redirectTo);
  const params = new URLSearchParams({
    token_hash: args.tokenHash,
    type: args.action,
    next,
  });
  return `${siteUrl}/auth/callback?${params.toString()}`;
}

/**
 * Pull `?next=` out of the redirect Supabase was given, but only ever accept a
 * path on this site. An open redirect here would be a phishing gift.
 */
function nextPathFrom(redirectTo: string | undefined): string {
  if (!redirectTo) return '/capsules';
  try {
    const url = new URL(redirectTo);
    const next = url.searchParams.get('next');
    if (!next) return '/capsules';
    if (!next.startsWith('/') || next.startsWith('//')) return '/capsules';
    return next;
  } catch {
    return '/capsules';
  }
}

export async function sendAuthEmail(args: {
  email: string;
  action: AuthAction;
  tokenHash: string;
  redirectTo?: string;
}): Promise<SendResult> {
  const actionUrl = buildActionUrl({
    tokenHash: args.tokenHash,
    action: args.action,
    redirectTo: args.redirectTo,
  });

  const { subject, html, text } = renderAuthEmail({ action: args.action, actionUrl });

  return sendBrevoMessage({
    // No display name: we only know the address, and inventing one would be worse
    // than the gentle default the mail client shows.
    to: { email: args.email },
    subject,
    html,
    text,
    tag: 'auth',
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
