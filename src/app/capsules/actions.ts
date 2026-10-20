'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { friendlyError } from '@/lib/utils';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const THEMES = ['cream', 'blush', 'butter', 'sage', 'cardboard'] as const;

/**
 * Server actions for the three write paths that are not contributions.
 *
 * Everything here runs with the *user's* session, so RLS still applies. A server
 * action is a transport choice, never a privilege escalation — if you catch
 * yourself reaching for the service role in this file, the policy is wrong
 * instead.
 */

export async function createCapsule(formData: FormData): Promise<ActionResult<{ id: string }>> {
  if (!env.isSupabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured yet. See .env.example.' };
  }

  const title = String(formData.get('title') ?? '').trim();
  const subtitle = String(formData.get('subtitle') ?? '').trim();
  const coverEmoji = String(formData.get('cover_emoji') ?? '🕰️').trim().slice(0, 8);
  const theme = String(formData.get('theme') ?? 'cream');
  const maxMembers = Number.parseInt(String(formData.get('max_members') ?? '12'), 10);
  const unlockAtRaw = String(formData.get('unlock_at') ?? '');

  if (title.length < 1 || title.length > 120) {
    return { ok: false, error: 'Give it a title between 1 and 120 characters.' };
  }

  const unlockAt = new Date(unlockAtRaw);
  if (Number.isNaN(unlockAt.getTime())) {
    return { ok: false, error: 'Pick a date for it to open.' };
  }

  // The database enforces "later than now" and "within 50 years". We check the
  // common case here so the user gets a sentence instead of a stack trace.
  const now = Date.now();
  if (unlockAt.getTime() <= now + 10_000) {
    return { ok: false, error: 'Pick a moment in the future — at least ten seconds away.' };
  }
  if (unlockAt.getTime() > now + 50 * 365.25 * 86400_000) {
    return { ok: false, error: 'Fifty years is the limit. Beyond that, who is this even for?' };
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  // For near-future unlocks (tests/presets like 5m/1h) keep the exact time.
  // For far-future capsules normalize to 12:00 UTC so the daily cron stays deterministic.
  const isNearFuture = unlockAt.getTime() - now < 48 * 60 * 60 * 1000;
  const finalUnlockAt = isNearFuture ? unlockAt.toISOString() : withUtcHour(unlockAt.toISOString(), 12);

  const { data, error } = await supabase
    .from('capsules')
    .insert({
      owner_id: user.id,
      title,
      subtitle: subtitle || null,
      cover_emoji: coverEmoji || '🕰️',
      theme: THEMES.includes(theme as (typeof THEMES)[number]) ? theme : 'cream',
      max_members: Number.isFinite(maxMembers) ? Math.min(20, Math.max(2, maxMembers)) : 12,
      // Noon UTC avoids a capsule opening at 23:40 on a Tuesday in one timezone
      // and 02:15 the next day in another. The daily cron then lands it squarely
      // inside "today" everywhere that matters.
      unlock_at: finalUnlockAt,
      seal_at: new Date().toISOString(),
    })
    .select('id')
    .single<{ id: string }>();

  if (error) return { ok: false, error: friendlyError(error) };

  revalidatePath('/capsules');
  return { ok: true, data: { id: data.id } };
}

export async function joinCapsuleByCode(code: string): Promise<ActionResult<{ id: string }>> {
  if (!env.isSupabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured yet.' };
  }

  const trimmed = code.trim().toUpperCase();
  if (trimmed.length < 4) return { ok: false, error: 'That code looks too short.' };

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  // SECURITY DEFINER RPC: it validates the code and enforces the member cap
  // inside the database, where a client cannot lie about either.
  const { data, error } = await supabase.rpc('join_capsule_by_code', { p_code: trimmed });

  if (error) {
    // The RPC raises with a human-readable prefix; strip it for the UI.
    const message = error.message
      .replace(/^invite:\s*/, '')
      .replace(/^capacity:\s*/, '')
      .replace(/^auth:\s*/, '');
    return { ok: false, error: message || friendlyError(error) };
  }

  revalidatePath('/capsules');
  return { ok: true, data: { id: String(data) } };
}

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  if (!env.isSupabaseConfigured) return { ok: false, error: 'Supabase is not configured yet.' };

  const displayName = String(formData.get('display_name') ?? '').trim().slice(0, 60);
  const handle = String(formData.get('handle') ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);
  const avatarEmoji = String(formData.get('avatar_emoji') ?? '🫧').trim().slice(0, 8);
  const accent = String(formData.get('accent_color') ?? '#F4C7C3');

  if (displayName.length < 1) return { ok: false, error: 'A display name helps people know it is you.' };
  if (handle.length < 3) return { ok: false, error: 'Handles need at least three letters, numbers or underscores.' };
  if (!/^#[0-9A-Fa-f]{6}$/.test(accent)) return { ok: false, error: 'That colour is not a hex code.' };

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName, handle, avatar_emoji: avatarEmoji || '🫧', accent_color: accent })
    .eq('id', user.id);

  if (error) {
    if (/duplicate key/i.test(error.message)) return { ok: false, error: 'That handle is already taken.' };
    return { ok: false, error: friendlyError(error) };
  }

  revalidatePath('/capsules');
  return { ok: true };
}

/** Force a specific UTC hour so unlock dates are comparable across timezones. */
function withUtcHour(iso: string, hour: number): string {
  const date = new Date(iso);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}
