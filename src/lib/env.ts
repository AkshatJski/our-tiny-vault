/**
 * Environment access, centralised so nothing else reads process.env directly.
 *
 * Every value here is optional at import time. That matters: the app must build
 * and boot *before* you paste in your Supabase keys, otherwise the first thing a
 * new contributor sees is a crash instead of a pretty landing page.
 */

const raw = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',

  // ── email providers ──────────────────────────────────────────────────────
  // Two supported senders, same template, same queue. Brevo wins when both are
  // configured because it is the one that can reach arbitrary recipients on a
  // $0 plan (Resend's free tier is locked to the account owner's address until
  // you verify a domain). Removing BREVO_API_KEY is the whole rollback: the
  // dispatcher falls back to Resend with no code change.
  brevoApiKey: process.env.BREVO_API_KEY ?? '',
  brevoFrom: (process.env.BREVO_FROM ?? '').trim(),
  brevoFromName: (process.env.BREVO_FROM_NAME ?? 'our tiny vault').trim(),
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  resendFrom: process.env.RESEND_FROM ?? 'our tiny vault <onboarding@resend.dev>',
  /** `brevo` | `resend` — pin the sender when both keys exist. */
  emailProviderOverride: (process.env.EMAIL_PROVIDER ?? '').trim().toLowerCase(),
  emailDailyCap: Number.parseInt(process.env.EMAIL_DAILY_CAP ?? process.env.RESEND_DAILY_CAP ?? '90', 10),
  resendDailyCap: Number.parseInt(process.env.RESEND_DAILY_CAP ?? '90', 10),

  cronSecret: process.env.CRON_SECRET ?? 'dev-secret',
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  enableKeepalive: process.env.ENABLE_KEEPALIVE !== 'false',
  enableWeeklyBackup: process.env.ENABLE_WEEKLY_BACKUP === 'true',
  cronMaxCapsules: Number.parseInt(process.env.CRON_MAX_CAPSULES_PER_RUN ?? '25', 10),
};

export type EmailProvider = 'brevo' | 'resend' | 'none';

/**
 * Who actually sends. Explicit key presence, never a silent guess:
 *
 *   EMAIL_PROVIDER set      → that one, or `none` if its keys are incomplete
 *   BREVO_API_KEY + FROM    → brevo   (the default on the $0 plan)
 *   RESEND_API_KEY          → resend  (the original path, still fully wired)
 *   neither                 → none    (queue keeps deferring, nothing is lost)
 */
function resolveEmailProvider(r: typeof raw): EmailProvider {
  const hasBrevo = r.brevoApiKey.length > 0 && r.brevoFrom.length > 0;
  const hasResend = r.resendApiKey.length > 0;
  const forced = r.emailProviderOverride;

  if (forced === 'brevo') return hasBrevo ? 'brevo' : 'none';
  if (forced === 'resend') return hasResend ? 'resend' : 'none';
  if (forced.length > 0 && forced !== 'auto') return 'none';

  if (hasBrevo) return 'brevo';
  if (hasResend) return 'resend';
  return 'none';
}

/** Only meaningful when nothing can send. Explains why, in one sentence. */
function explainNoEmail(r: typeof raw): string {
  const forced = r.emailProviderOverride;
  if (forced === 'brevo' || forced === 'resend') {
    return `EMAIL_PROVIDER=${forced} but that provider's keys are incomplete.`;
  }
  if (r.brevoApiKey.length > 0) {
    return 'BREVO_API_KEY is set but BREVO_FROM is empty — set the address you verified in Brevo.';
  }
  return 'No email provider configured (set BREVO_API_KEY + BREVO_FROM, or RESEND_API_KEY).';
}

/**
 * Non-fatal, but always worth saying out loud: mail still goes out, just not the
 * way you probably meant. Silence here is how you end up wondering why nobody
 * got the email for six months.
 */
function explainEmailWarning(r: typeof raw, provider: EmailProvider): string | null {
  if (r.brevoApiKey.length > 0 && r.brevoFrom.length === 0 && provider !== 'none') {
    return `BREVO_API_KEY is set but BREVO_FROM is empty — falling back to ${provider}.`;
  }
  if (provider === 'resend' && typeof r.resendApiKey === 'string' && r.resendApiKey.length > 0) {
    return (
      'Sending via Resend with no verified domain: only the Resend account owner ' +
      'receives mail. Set BREVO_API_KEY + BREVO_FROM to reach other members.'
    );
  }
  return null;
}

const emailProvider = resolveEmailProvider(raw);

export const env = {
  ...raw,
  emailProvider,
  /** Null when a provider is ready. Otherwise: why nothing can send. */
  emailConfigProblem: emailProvider === 'none' ? explainNoEmail(raw) : null,
  /** Non-fatal half-configuration. Surfaced by /api/health, never blocks a send. */
  emailConfigWarning: explainEmailWarning(raw, emailProvider),
  /** Hard failsafe against a 100/day cap. 100 would leave zero retry headroom. */
  resendDailyCap: Math.min(Math.max(raw.resendDailyCap, 1), 90),
  /** Same clamp for the provider-neutral budget (Brevo allows 300/day; we don't need it). */
  emailDailyCap: Math.min(Math.max(raw.emailDailyCap, 1), 90),
  isSupabaseConfigured: raw.supabaseUrl.length > 0 && raw.supabaseAnonKey.length > 0,
  /** True when *either* sender is ready. Callers ask the dispatcher, not this. */
  isEmailConfigured: emailProvider !== 'none',
  isCronConfigured: raw.supabaseServiceKey.length > 0,
};

export function assertSupabaseConfigured() {
  if (!env.isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and set ' +
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
}

export function assertServiceRole() {
  if (!env.supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for cron routes.');
  }
}
