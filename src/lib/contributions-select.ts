/**
 * The column lists used to read contributions and guesses.
 *
 * ── WHY THIS FILE EXISTS, SEPARATELY ────────────────────────────────────────
 * These are just strings — plain data, safe to use on the server *and* in the
 * browser. They used to live in `lib/contributions.ts`, which is stamped
 * `'use client'`. Next.js treats every export of a `'use client'` module as
 * browser-only and swaps it for a stub on the server, so a server component
 * that called `.select(CONTRIBUTIONS_SELECT)` crashed with:
 *
 *     Attempted to call split() from the server but split is on the client.
 *
 * Only the OPEN capsule page ever ran that query, so the bug stayed invisible
 * until the first capsule unlocked.
 *
 * So: data here (importable anywhere), browser code in `lib/contributions.ts`.
 * Keep these two files in sync — this is the one description of the shape of a
 * contribution, and the app breaks in a confusing way if they drift.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const CONTRIBUTIONS_SELECT = `id, capsule_id, author_id, kind, body, storage_path,
  mime_type, byte_size, duration_seconds, external_url, external_provider, created_at,
  author:profiles!contributions_author_id_fkey(id, handle, display_name, avatar_emoji, accent_color)`;

export const PREDICTIONS_SELECT = `id, capsule_id, author_id, prompt_key, prompt_text, guess,
  resolved_guess, is_correct, resolved_at, resolved_by, created_at,
  author:profiles!prediction_responses_author_id_fkey(id, handle, display_name, avatar_emoji)`;
