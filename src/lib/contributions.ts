'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { extensionForMime } from '@/lib/compression';
import type {
  ContributionKind,
  ContributionWithAuthor,
  ExternalProvider,
  PredictionWithAuthor,
} from '@/lib/types';

/**
 * The only place contributions and guesses are written.
 *
 * ── THE RULE THAT SHAPES THIS FILE ──────────────────────────────────────────
 * Before unlock, the SELECT policy on `contributions` is false. In Postgres,
 * `INSERT ... RETURNING` requires SELECT permission on the produced row, so
 * `.insert(x).select()` fails with 42501 — for everyone, including the author.
 *
 * We therefore insert with `Prefer: return=minimal` (no `.select()`), get back
 * `data: null`, and return a locally-constructed echo for the optimistic UI.
 * That local object is a *memory aid*, not a claim about the database: it is
 * never re-read from the server before the capsule opens.
 * ────────────────────────────────────────────────────────────────────────────
 */

// The column lists live in a server-safe module, because this file is
// `'use client'` and the server cannot call into it. Re-exported so the browser
// imports below stay one line apiece. See `contributions-select.ts`.
export { CONTRIBUTIONS_SELECT, PREDICTIONS_SELECT } from '@/lib/contributions-select';
import { CONTRIBUTIONS_SELECT, PREDICTIONS_SELECT } from '@/lib/contributions-select';

export interface SealContributionInput {
  capsuleId: string;
  authorId: string;
  kind: ContributionKind;
  body?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  byteSize?: number;
  durationSeconds?: number | null;
  externalUrl?: string | null;
  externalProvider?: ExternalProvider | null;
}

export async function uploadCapsuleMedia(
  client: SupabaseClient,
  args: { capsuleId: string; userId: string; file: File },
): Promise<{ path: string; mimeType: string; byteSize: number }> {
  const ext = extensionForMime(args.file.type);
  // Path convention is enforced by the storage RLS policy in 0004_storage.sql.
  const path = `${args.capsuleId}/${args.userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await client.storage.from('capsule-media').upload(path, args.file, {
    contentType: args.file.type,
    upsert: false,
    // A capsule photo is immutable, so it may be cached essentially forever.
    cacheControl: '31536000',
  });

  if (error) throw error;
  return { path, mimeType: args.file.type, byteSize: args.file.size };
}

export interface SealedContribution {
  /** Local echo only — the database has not returned this row. */
  contribution: ContributionWithAuthor;
}

export async function sealContribution(
  client: SupabaseClient,
  input: SealContributionInput,
  author: ContributionWithAuthor['author'],
): Promise<SealedContribution> {
  const row = {
    capsule_id: input.capsuleId,
    author_id: input.authorId,
    kind: input.kind,
    body: input.body ?? null,
    storage_path: input.storagePath ?? null,
    mime_type: input.mimeType ?? null,
    byte_size: input.byteSize ?? 0,
    duration_seconds: input.durationSeconds ?? null,
    external_url: input.externalUrl ?? null,
    external_provider: input.externalProvider ?? null,
  };

  // NOTE: no .select() — see the file header. This is intentional, not a typo.
  const { error } = await client.from('contributions').insert(row);
  if (error) throw error;

  const now = new Date().toISOString();
  return {
    contribution: {
      id: `local-${crypto.randomUUID()}`,
      ...row,
      created_at: now,
      author: author ?? null,
    },
  };
}

export interface SealPredictionInput {
  capsuleId: string;
  authorId: string;
  promptKey: string;
  promptText: string;
  guess: string;
}

export async function sealPrediction(
  client: SupabaseClient,
  input: SealPredictionInput,
  author: PredictionWithAuthor['author'],
): Promise<PredictionWithAuthor> {
  const row = {
    capsule_id: input.capsuleId,
    author_id: input.authorId,
    prompt_key: input.promptKey,
    prompt_text: input.promptText,
    guess: input.guess.trim(),
  };

  const { error } = await client.from('prediction_responses').insert(row);
  if (error) throw error;

  return {
    id: `local-${crypto.randomUUID()}`,
    ...row,
    resolved_guess: null,
    is_correct: null,
    resolved_at: null,
    resolved_by: null,
    created_at: new Date().toISOString(),
    author: author ?? null,
  };
}

/** Only meaningful after unlock — before that the policy simply returns nothing. */
export async function fetchContributions(
  client: SupabaseClient,
  capsuleId: string,
): Promise<ContributionWithAuthor[]> {
  const { data, error } = await client
    .from('contributions')
    .select(CONTRIBUTIONS_SELECT)
    .eq('capsule_id', capsuleId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ContributionWithAuthor[];
}

export async function fetchPredictions(
  client: SupabaseClient,
  capsuleId: string,
): Promise<PredictionWithAuthor[]> {
  const { data, error } = await client
    .from('prediction_responses')
    .select(PREDICTIONS_SELECT)
    .eq('capsule_id', capsuleId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PredictionWithAuthor[];
}

export async function resolvePrediction(
  client: SupabaseClient,
  predictionId: string,
  userId: string,
  args: { resolvedGuess: string; isCorrect: boolean },
): Promise<void> {
  const { error } = await client
    .from('prediction_responses')
    .update({
      resolved_guess: args.resolvedGuess,
      is_correct: args.isCorrect,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', predictionId);
  if (error) throw error;
}

/**
 * Private bucket -> signed URL. Short-lived (10 minutes) because the page that
 * requests it also renders it immediately; nothing needs a durable public link.
 */
export async function signedMediaUrl(
  client: SupabaseClient,
  path: string,
  seconds = 600,
): Promise<string | null> {
  const { data, error } = await client.storage.from('capsule-media').createSignedUrl(path, seconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function deleteContribution(
  client: SupabaseClient,
  contribution: { id: string; storage_path: string | null },
): Promise<void> {
  if (contribution.storage_path) {
    await client.storage.from('capsule-media').remove([contribution.storage_path]);
  }
  const { error } = await client.from('contributions').delete().eq('id', contribution.id);
  if (error) throw error;
}
