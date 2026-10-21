import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { normalizeAction, sendAuthEmail } from '@/lib/auth-email';
import { verifyWebhookSignature } from '@/lib/hook-signature';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Supabase Auth's Send Email hook.
 *
 * When enabled, Supabase stops sending sign-in mail itself and POSTs the token
 * here instead; whatever we answer is what the user receives. This exists
 * because their own senders cannot be used for an app you share: the built-in
 * mailer only reaches your own team (2/hour), and custom SMTP saved correctly
 * but failed at handover with an opaque 500 on every attempt.
 *
 * The contract:
 *   in   { user: { email, … }, email_data: { token_hash, redirect_to, email_action_type, … } }
 *   out  200 {} on success, or 500 { error: { http_code, message } }
 *
 * Security: the endpoint is public by necessity, so the signature check is the
 * door. Reject first, parse second, send last.
 */

interface HookPayload {
  user?: { email?: string | null; id?: string | null } | null;
  email_data?: {
    token_hash?: string | null;
    redirect_to?: string | null;
    email_action_type?: string | null;
  } | null;
}

export async function POST(request: Request): Promise<NextResponse> {
  // Raw text, not .json(): the signature is over the exact bytes Supabase sent.
  const rawBody = await request.text();

  const verdict = verifyWebhookSignature({
    rawBody,
    id: request.headers.get('webhook-id'),
    timestamp: request.headers.get('webhook-timestamp'),
    signature: request.headers.get('webhook-signature'),
    secret: env.sendEmailHookSecret,
  });

  if (!verdict.ok) {
    // Logged for you, never echoed to the caller: telling an attacker *why* a
    // signature failed is a gift.
    console.warn(`auth/send-email: rejected — ${verdict.reason}`);
    return NextResponse.json(
      { error: { http_code: 401, message: 'unauthorized' } },
      { status: 401 },
    );
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
  } catch {
    return failure(400, 'payload was not valid JSON');
  }

  const email = payload.user?.email?.trim();
  const tokenHash = payload.email_data?.token_hash?.trim();

  if (!email || !tokenHash) {
    return failure(400, 'payload was missing the email or the token hash');
  }

  const action = normalizeAction(payload.email_data?.email_action_type ?? undefined);

  const result = await sendAuthEmail({
    email,
    action,
    tokenHash,
    redirectTo: payload.email_data?.redirect_to ?? undefined,
  });

  if (!result.ok) {
    // A skipped result means Brevo is not configured; either way Supabase should
    // surface a failure rather than pretend the mail went out.
    console.error(`auth/send-email: ${action} for ${maskEmail(email)} failed — ${result.error ?? result.skipped}`);
    return failure(500, result.error ?? 'email sender is not configured');
  }

  console.log(`auth/send-email: ${action} for ${maskEmail(email)} sent (${result.id ?? 'no id'})`);
  return NextResponse.json({}, { status: 200 });
}

function failure(httpCode: number, message: string): NextResponse {
  return NextResponse.json({ error: { http_code: httpCode, message } }, { status: httpCode });
}

/** Logs are useful; a full address in them is not. `a…@gmail.com` is enough. */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}
