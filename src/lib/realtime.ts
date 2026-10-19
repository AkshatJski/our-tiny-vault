import { PRESENCE_CAP } from '@/lib/budget';

/**
 * Shared vocabulary for the live opening party.
 *
 * We use Supabase Realtime over *broadcast + presence*, not Postgres changes.
 * Reasons that matter for the free tier:
 *
 *   • broadcast/presence messages do not write rows, so they cost 0 DB storage
 *     and 0 database CPU. A 45-minute party is free.
 *   • one channel per capsule means one websocket per tab. The free tier allows
 *     200 concurrent connections; PRESENCE_CAP (20) keeps ten parties possible.
 *   • the channel is ephemeral, and losing a socket loses nothing that matters.
 *
 * `postgres_changes` is deliberately NOT used in the lobby: it would stream rows
 * from `contributions`, and streaming is reading. Before unlock that would be an
 * RLS hole wearing a hat.
 */

export const CAPSULE_CHANNEL_PREFIX = 'capsule';

export function partyChannelName(capsuleId: string): string {
  return `${CAPSULE_CHANNEL_PREFIX}:${capsuleId}:party`;
}

/** Broadcast event names (client -> all clients). */
export const BROADCAST = {
  reaction: 'reaction',
  unwrapProgress: 'unwrap_progress',
  sealBroken: 'seal_broken',
  scratchReveal: 'scratch_reveal',
  presenceHello: 'hello',
} as const;

export interface ReactionMessage {
  emoji: string;
  /** Local nonce so two identical reactions still animate separately. */
  nonce: string;
  userId: string;
  name: string;
}

export interface UnwrapProgressMessage {
  userId: string;
  name: string;
  /** 0..1 — how far this person has dragged their strand of string. */
  pull: number;
}

export interface SealBrokenMessage {
  userId: string;
  name: string;
  at: string;
}

export interface ScratchRevealMessage {
  predictionId: string;
  userId: string;
  isCorrect: boolean;
}

export interface PartyMember {
  userId: string;
  name: string;
  emoji: string;
  slot: number;
  joinedAt: string;
}

/**
 * Cooperative unwrap maths.
 *
 * Each member can contribute at most one full "pull". The seal breaks when the
 * combined pull covers the number of people currently present — so two people
 * must each pull halfway, or one person can pull the whole thing (because
 * sometimes you open a capsule on your own at 2am, and that should work).
 */
export function combinedPull(pulls: Record<string, number>, presentCount: number): number {
  const total = Object.values(pulls).reduce((sum, value) => sum + Math.max(0, Math.min(1, value)), 0);
  const required = Math.max(1, presentCount);
  return Math.min(1, total / required);
}

export const UNWRAP_REQUIRED_RATIO = 0.82;
export const UNWRAP_BREAK_AT = UNWRAP_REQUIRED_RATIO;

export const REACTION_EMOJI = ['🥹', '🫶', '🎉', '😭', '🌿', '🕰️', '✨', '🫧', '📎', '🍰'] as const;

/** Presence count guard that mirrors the server-side slot claim. */
export function presenceIsFull(present: number): boolean {
  return present >= PRESENCE_CAP;
}
