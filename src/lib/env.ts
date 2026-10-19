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
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  resendFrom: process.env.RESEND_FROM ?? 'our tiny vault <onboarding@resend.dev>',
  resendDailyCap: Number.parseInt(process.env.RESEND_DAILY_CAP ?? '90', 10),
  cronSecret: process.env.CRON_SECRET ?? 'dev-secret',
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  enableKeepalive: process.env.ENABLE_KEEPALIVE !== 'false',
  enableWeeklyBackup: process.env.ENABLE_WEEKLY_BACKUP === 'true',
  cronMaxCapsules: Number.parseInt(process.env.CRON_MAX_CAPSULES_PER_RUN ?? '25', 10),
};

export const env = {
  ...raw,
  /** Hard failsafe against Resend's 100/day free cap. Never allow 100. */
  resendDailyCap: Math.min(Math.max(raw.resendDailyCap, 1), 90),
  isSupabaseConfigured: raw.supabaseUrl.length > 0 && raw.supabaseAnonKey.length > 0,
  isEmailConfigured: raw.resendApiKey.length > 0,
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
