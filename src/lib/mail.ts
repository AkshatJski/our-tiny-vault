import { env } from '@/lib/env';
import { sendUnlockEmail as sendWithResend } from '@/lib/resend';
import { sendViaBrevo } from '@/lib/brevo';
import type { SendResult, UnlockEmailArgs } from '@/lib/resend';

/**
 * The one place that decides who sends the letter.
 *
 * Everything above this line (the cron, the queue, the template) is provider
 * agnostic. Swapping providers means adding a `case` here — or, for the common
 * case, doing nothing at all: `env.emailProvider` reads the keys that are
 * present, so dropping BREVO_API_KEY into the environment is the entire switch,
 * and deleting it is the entire rollback.
 *
 * Never throws. A dead provider returns `{ ok: false }`, which the cron turns
 * into a deferred row rather than a lost notification.
 */

export type { SendResult, UnlockEmailArgs };

export function activeEmailProvider() {
  return env.emailProvider;
}

export async function sendUnlockEmail(args: UnlockEmailArgs): Promise<SendResult> {
  switch (env.emailProvider) {
    case 'brevo':
      return sendViaBrevo(args);
    case 'resend':
      return sendWithResend(args);
    default:
      return { ok: false, id: null, skipped: 'not_configured' };
  }
}
