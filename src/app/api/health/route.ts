import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — the cheap external keep-alive, and a status page for you.
 *
 * Point a free uptime pinger at this URL once a day. It runs one trivial query
 * against Supabase, which is all it takes to reset the seven-day inactivity
 * timer on a free project. No secrets are returned; nothing here is user data.
 *
 * The response is deliberately honest about what is NOT configured. A health
 * check that returns 200 while email is silently disabled is worse than useless.
 */
export async function GET() {
  const startedAt = Date.now();
  const day = new Date().toISOString().slice(0, 10);

  const status = {
    ok: true,
    app: 'our tiny vault',
    time: new Date().toISOString(),
    day,
    budget: {
      storageCeilingBytes: 900 * 1024 * 1024,
      emailDailyCap: env.emailDailyCap,
      presenceCapPerCapsule: 20,
      cronCadence: '0 0 * * * (once daily — Vercel Hobby limit)',
    },
    configured: {
      supabase: env.isSupabaseConfigured,
      serviceRole: env.isCronConfigured,
      email: env.isEmailConfigured,
      emailProvider: env.emailProvider,
    },
    supabase: 'unconfigured' as 'ok' | 'unconfigured' | 'unreachable' | 'error',
    heartbeatToday: false,
    storageBytes: null as number | null,
    latencyMs: 0,
    notes: [] as string[],
  };

  if (!env.isSupabaseConfigured) {
    status.notes.push('Supabase keys are missing, so nothing is persisted yet.');
  } else if (!env.isCronConfigured) {
    status.notes.push('No service role key: the daily cron and this keep-alive cannot touch the DB.');
  } else {
    try {
      const admin = createAdminSupabase();

      // Reads a real row: one indexed lookup, no table scan, no data returned.
      const { data: beat, error: beatError } = await admin
        .from('system_heartbeats')
        .select('beat_date, source')
        .eq('beat_date', day)
        .limit(1);

      if (beatError) {
        status.supabase = 'error';
        status.notes.push(`heartbeat query failed: ${beatError.message}`);
      } else {
        status.supabase = 'ok';
        status.heartbeatToday = (beat ?? []).length > 0;
        if (!status.heartbeatToday) {
          status.notes.push('No heartbeat recorded today yet — the cron runs at 00:00 UTC.');
        }
      }

      const { data: overview } = await admin
        .from('storage_overview')
        .select('bucket_id, bytes_used')
        .eq('bucket_id', 'capsule-media')
        .maybeSingle<{ bucket_id: string; bytes_used: number }>();

      status.storageBytes = overview?.bytes_used ?? null;
    } catch (error) {
      status.supabase = 'unreachable';
      status.notes.push(error instanceof Error ? error.message : 'unknown Supabase failure');
    }
  }

  if (!env.isEmailConfigured) {
    status.notes.push(
      `${env.emailConfigProblem ?? 'No email provider'} Unlock emails will be deferred, not lost.`,
    );
  } else if (env.emailConfigWarning) {
    status.notes.push(env.emailConfigWarning);
  }

  status.latencyMs = Date.now() - startedAt;
  status.ok = status.supabase !== 'unreachable' && status.supabase !== 'error';

  return NextResponse.json(status, {
    status: status.ok ? 200 : 500,
    headers: { 'Cache-Control': 'no-store' },
  });
}
