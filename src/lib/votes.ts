import type { SupabaseClient } from '@supabase/supabase-js';
import type { PredictionVote } from '@/lib/types';

/**
 * Votes on guesses.
 *
 * Deliberately NOT a `'use client'` module. This started life inside
 * `lib/contributions.ts`, which is marked for the browser because it pulls in
 * compression helpers — and a server component that imports a function from a
 * client module does not receive the function, it receives a proxy that only
 * resolves in the browser. Calling it during a server render therefore threw
 * `TypeError: (0, b.wA) is not a function`, and only on the unlock path, because
 * that is the only place the votes were read.
 *
 * Data functions like these belong in a directive-free file so both the server
 * pages and the client pinboard can call them.
 */

/**
 * Every vote on the guesses in one capsule.
 *
 * Post-unlock only — the policy on `prediction_votes` resolves through
 * `prediction_responses`, so while the capsule is sealed this returns nothing
 * even for its own author. The client never has to remember to ask nicely.
 */
export async function fetchPredictionVotes(
  client: SupabaseClient,
  predictionIds: string[],
): Promise<PredictionVote[]> {
  if (predictionIds.length === 0) return [];

  const { data, error } = await client
    .from('prediction_votes')
    .select('prediction_id, user_id, vote, created_at, updated_at')
    .in('prediction_id', predictionIds);
  if (error) throw error;
  return (data ?? []) as PredictionVote[];
}

/**
 * Put your vote in, or change it.
 *
 * `upsert` is what makes "you can change your mind" work without a second
 * endpoint; postgrest turns it into INSERT … ON CONFLICT DO UPDATE, which is why
 * `0007` grants both an INSERT and an UPDATE policy — with only one, switching
 * your answer fails with 42501.
 */
export async function castPredictionVote(
  client: SupabaseClient,
  args: { predictionId: string; userId: string; vote: boolean },
): Promise<void> {
  const { error } = await client.from('prediction_votes').upsert(
    {
      prediction_id: args.predictionId,
      user_id: args.userId,
      vote: args.vote,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'prediction_id,user_id' },
  );
  if (error) throw error;
}
