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
  // Use the SAME instant for seal_at and all comparisons to avoid millisecond races.
  const sealAt = new Date();
  const nowMs = sealAt.getTime();
  if (unlockAt.getTime() <= nowMs + 1000) {
    return { ok: false, error: 'Pick a moment in the future — at least a second away.' };
  }
  if (unlockAt.getTime() > nowMs + 50 * 365.25 * 86400_000) {
    return { ok: false, error: 'Fifty years is the limit. Beyond that, who is this even for?' };
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  // For near-future unlocks (tests/presets like 5m/1h) keep the exact time.
  // For far-future capsules normalize to 12:00 UTC so the daily cron stays deterministic.
  const isNearFuture = unlockAt.getTime() - nowMs < 48 * 60 * 60 * 1000;
  let finalUnlockAt: string;
  if (isNearFuture) {
    // Guarantee unlock_at is at least 2 seconds after sealAt to satisfy DB constraint
    const minUnlock = nowMs + 2000;
    const chosen = unlockAt.getTime();
    finalUnlockAt = new Date(chosen > minUnlock ? chosen : minUnlock).toISOString();
  } else {
    finalUnlockAt = withUtcHour(unlockAt.toISOString(), 12);
  }

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
      seal_at: sealAt.toISOString(),
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

export async function deleteCapsule(capsuleId: string): Promise<ActionResult> {
  if (!env.isSupabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured yet.' };
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  const id = String(capsuleId ?? '').trim();
  if (!id) return { ok: false, error: 'Missing capsule ID.' };

  const { data: capsule, error: cErr } = await supabase
    .from('capsules')
    .select('id, owner_id, unlock_at')
    .eq('id', id)
    .single<{ id: string; owner_id: string; unlock_at: string }>();
  if (cErr || !capsule) return { ok: false, error: 'Capsule not found.' };
  if (capsule.owner_id !== user.id) return { ok: false, error: 'Only the owner can delete this vault.' };

  const unlocked = new Date(capsule.unlock_at).getTime() <= Date.now();
  if (!unlocked) return { ok: false, error: 'You can only delete the vault after it has opened.' };

  // Media first, row second. Postgres cascades contributions and memberships
  // when the capsule row goes, but storage objects sit in `storage.objects`
  // with no foreign key to `capsules` — the cascade cannot see them.
  //
  // Order matters both ways: if we deleted the row first, the RLS policy that
  // authorises this cleanup (`capsule_media_owner_delete`, see 0006) would stop
  // matching, because it requires the capsule to still be open and ours. So the
  // bytes go while the row still exists, and a storage failure aborts the whole
  // delete rather than leaving a half-deleted vault nobody can see.
  const cleared = await clearCapsuleMedia(supabase, id);
  if (!cleared.ok) {
    return { ok: false, error: `Could not clear this vault's media, so nothing was deleted. ${cleared.error}` };
  }

  const { error } = await supabase.from('capsules').delete().eq('id', id).eq('owner_id', user.id);
  if (error) {
    // The media is already gone at this point, so the generic message would be a
    // lie ("nothing was deleted"). Say what actually happened.
    return {
      ok: false,
      error: `This vault's files were cleared, but the vault itself could not be deleted. ${friendlyError(error)}`,
    };
  }

  revalidatePath('/capsules');
  return { ok: true };
}

/**
 * List every object under `{capsuleId}/` in the media bucket.
 *
 * The path convention is `{capsule_id}/{author_id}/{uuid}.{ext}`, so the top
 * level is a list of author folders — one extra level to walk. `list()` returns
 * folders with `metadata: null` and files with metadata set, which is how the two
 * are told apart without guessing from names.
 *
 * Paged rather than `limit: 1000` and hoping: a truncated listing would look
 * like a complete one, and deleting only part of a vault is the leak again in
 * smaller pieces.
 *
 * Runs as the signed-in owner on purpose: the policy decides whether this is
 * allowed, not this function. No service role here.
 */
async function listCapsuleMedia(
  supabase: ReturnType<typeof createServerSupabase>,
  capsuleId: string,
): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }> {
  const PAGE = 100;

  const listAll = async (prefix: string) => {
    const all: Array<{ name: string; metadata: Record<string, unknown> | null }> = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase.storage
        .from('capsule-media')
        .list(prefix, { limit: PAGE, offset });
      if (error) return { ok: false as const, error: error.message };
      const page = (data ?? []) as Array<{ name: string; metadata: Record<string, unknown> | null }>;
      all.push(...page);
      if (page.length < PAGE) return { ok: true as const, entries: all };
    }
  };

  const top = await listAll(capsuleId);
  if (!top.ok) return top;

  const paths: string[] = [];
  for (const entry of top.entries) {
    if (entry.metadata) {
      // A file sitting directly in the capsule folder (not expected, but cheap).
      paths.push(`${capsuleId}/${entry.name}`);
      continue;
    }
    const sub = await listAll(`${capsuleId}/${entry.name}`);
    if (!sub.ok) return sub;
    for (const file of sub.entries) {
      if (file.metadata) paths.push(`${capsuleId}/${entry.name}/${file.name}`);
    }
  }

  return { ok: true, paths };
}

/**
 * Empty `{capsuleId}/`, or fail without having deleted anything decisive.
 *
 * The contract the caller relies on: `ok: true` means the prefix is provably
 * empty right now — verified by re-listing, not inferred from a status code.
 */
async function clearCapsuleMedia(
  supabase: ReturnType<typeof createServerSupabase>,
  capsuleId: string,
): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const before = await listCapsuleMedia(supabase, capsuleId);
  if (!before.ok) return before;
  if (before.paths.length === 0) return { ok: true, removed: 0 };

  const { data, error } = await supabase.storage.from('capsule-media').remove(before.paths);
  if (error) return { ok: false, error: error.message };

  // The status code is not evidence. Storage answers 200 even when RLS filters
  // out every row, handing back an empty list instead of an error — verified
  // against the live project: a refused delete of two objects returned
  // `HTTP 200, objects actually removed: 0/2`. Trusting that would let us
  // delete the row below while the bytes stay in the bucket forever, which is
  // the precise leak this function exists to prevent, only now with a false
  // "done".
  const removed = data?.length ?? 0;
  if (removed < before.paths.length) {
    return {
      ok: false,
      error:
        `Only ${removed} of ${before.paths.length} file(s) could be removed — storage ` +
        `refused the rest, most likely because migration ` +
        `0006_storage_owner_delete.sql has not been applied yet.`,
    };
  }

  // Ground truth. The returned list says what storage believes it deleted; this
  // says what is actually left. If anything survived (a concurrent upload, a
  // page that slipped past), refuse to delete the row and orphan it.
  const after = await listCapsuleMedia(supabase, capsuleId);
  if (!after.ok) return after;
  if (after.paths.length > 0) {
    return {
      ok: false,
      error: `${after.paths.length} file(s) are still in this vault's storage.`,
    };
  }

  return { ok: true, removed };
}

/** Force a specific UTC hour so unlock dates are comparable across timezones. */
function withUtcHour(iso: string, hour: number): string {
  const date = new Date(iso);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}
