'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { DotDivider, Stamp } from '@/components/ui/PaperBits';
import { ScrapbookGrid } from '@/components/ScrapbookGrid';
import { PredictionPinboard } from '@/components/PredictionPinboard';
import { ReactionTray, type FloatingReaction } from '@/components/party/ReactionTray';
import { UnwrapString } from '@/components/party/UnwrapString';
import { ensureRealtimeAuth, getBrowserSupabase } from '@/lib/supabase/client';
import { fetchContributions, fetchPredictions } from '@/lib/contributions';
import {
  BROADCAST,
  combinedPull,
  partyChannelName,
  type PartyMember,
  type ReactionMessage,
  type SealBrokenMessage,
  type UnwrapProgressMessage,
} from '@/lib/realtime';
import type {
  CapsuleSummary,
  ContributionWithAuthor,
  PredictionVote,
  PredictionWithAuthor,
  Profile,
  RealtimeTicket,
} from '@/lib/types';
import { friendlyError, formatUnlockMoment } from '@/lib/utils';
import { playChime } from '@/lib/sound';

type LobbyProfile = Pick<Profile, 'id' | 'handle' | 'display_name' | 'avatar_emoji' | 'accent_color'>;

/**
 * The live opening party.
 *
 * ── THE CONNECTION BUDGET ───────────────────────────────────────────────────
 * One channel, one websocket per tab, for the whole party. Presence and
 * broadcasts share it. The free tier's 200 concurrent connections therefore
 * support ten simultaneous capsules at our 20-person cap — and because presence
 * is claimed server-side (see /api/realtime), the 21st arrival is downgraded to
 * spectator instead of being silently dropped by Supabase.
 *
 * ── WHY BROADCAST AND NOT postgres_changes ──────────────────────────────────
 * `postgres_changes` would stream rows from `contributions`, and streaming is
 * reading. Before unlock, an RLS-protected table must not be streamed to anyone.
 * Broadcast messages are ephemeral, cost nothing, and leak nothing.
 *
 * The lobby is also the only place the party log is written: two rows
 * (`party_opened`, `unwrap_seal_broken`) so that the event has a durable trace in
 * `realtime_events` even though the live path is socket-only.
 */
export function PartyLobby({
  capsule,
  profile,
  initiallyUnlocked,
  ceremonyAt,
  initialContributions,
  initialPredictions,
  initialVotes,
}: {
  capsule: CapsuleSummary;
  profile: LobbyProfile;
  /** True once the group has already pulled this seal open — not merely once RLS allows reading. */
  initiallyUnlocked: boolean;
  ceremonyAt?: string | null;
  initialContributions: ContributionWithAuthor[];
  initialPredictions: PredictionWithAuthor[];
  initialVotes: PredictionVote[];
}) {
  const [ticket, setTicket] = useState<RealtimeTicket | null>(null);
  const [connected, setConnected] = useState(false);
  const [spectator, setSpectator] = useState(false);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [pulls, setPulls] = useState<Record<string, number>>({});
  const [broken, setBroken] = useState(initiallyUnlocked);
  const [contributions, setContributions] = useState<ContributionWithAuthor[]>(initialContributions);
  const [predictions, setPredictions] = useState<PredictionWithAuthor[]>(initialPredictions);
  const [loadingContents, setLoadingContents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const loadedContentsRef = useRef(initiallyUnlocked);

  // ── spawn a floating reaction ───────────────────────────────────────────
  const spawnReaction = useCallback((message: { emoji: string; nonce?: string; name?: string }) => {
    const id = message.nonce ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lane = Math.random();
    setReactions((prev) => [...prev.slice(-24), { id, emoji: message.emoji, from: message.name ?? '', lane }]);
    window.setTimeout(() => {
      setReactions((prev) => prev.filter((item) => item.id !== id));
    }, 3000);
  }, []);

  // ── load the sealed contents once the capsule is open ───────────────────
  const loadContents = useCallback(async () => {
    if (loadedContentsRef.current) return;
    loadedContentsRef.current = true;
    setLoadingContents(true);
    try {
      const supabase = getBrowserSupabase();
      const [nextContributions, nextPredictions] = await Promise.all([
        fetchContributions(supabase, capsule.id),
        fetchPredictions(supabase, capsule.id),
      ]);
      setContributions(nextContributions);
      setPredictions(nextPredictions);
    } catch (err) {
      setError(friendlyError(err));
      loadedContentsRef.current = false;
    } finally {
      setLoadingContents(false);
    }
  }, [capsule.id]);

  // ── connect ────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let supabase: ReturnType<typeof getBrowserSupabase>;

    try {
      supabase = getBrowserSupabase();
    } catch (err) {
      setError(friendlyError(err));
      return;
    }

    const connect = async () => {
      try {
        await ensureRealtimeAuth(supabase);

        const response = await fetch('/api/realtime', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ capsuleId: capsule.id }),
        });

        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(detail?.error ?? 'Could not join the party channel.');
        }

        const nextTicket = (await response.json()) as RealtimeTicket;
        if (disposed) return;
        setTicket(nextTicket);

        const full = !nextTicket.presence.granted;
        setSpectator(full);

        const channel = supabase.channel(partyChannelName(capsule.id), {
          config: {
            // Our own messages are applied locally for instant feedback, so we
            // do not need the socket to echo them back to us.
            broadcast: { self: false, ack: false },
            presence: { key: profile.id },
          },
        });
        channelRef.current = channel;

        // ── broadcasts ──────────────────────────────────────────────────
        channel.on('broadcast', { event: BROADCAST.reaction }, ({ payload }) => {
          const message = payload as ReactionMessage & { emoji: string };
          if (message?.userId === profile.id) return;
          spawnReaction({ emoji: message.emoji, nonce: message.nonce, name: message.name });
        });

        channel.on('broadcast', { event: BROADCAST.unwrapProgress }, ({ payload }) => {
          const message = payload as UnwrapProgressMessage;
          if (!message?.userId || message.userId === profile.id) return;
          setPulls((prev) => ({ ...prev, [message.userId]: Math.max(0, Math.min(1, message.pull)) }));
        });

        channel.on('broadcast', { event: BROADCAST.sealBroken }, () => {
          setBroken((wasBroken) => {
            if (!wasBroken) playChime();
            return true;
          });
        });

        // ── presence ────────────────────────────────────────────────────
        // Registered for everyone, spectators included. What the 20-slot cap
        // governs is *tracking*, not listening — a spectator that never syncs
        // presence sees an empty member list and reports "watching with 1"
        // while twenty people are actually pulling the rope.
        channel.on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState<{
            name?: string;
            emoji?: string;
            slot?: number;
            joinedAt?: string;
          }>();
          const next: PartyMember[] = Object.entries(state).map(([key, metas]) => {
            const meta = (metas[0] ?? {}) as { name?: string; emoji?: string; slot?: number; joinedAt?: string };
            return {
              userId: key,
              name: meta.name ?? 'someone',
              emoji: meta.emoji ?? '🫧',
              slot: meta.slot ?? 0,
              joinedAt: meta.joinedAt ?? new Date().toISOString(),
            };
          });
          setMembers(next);
        });

        channel.subscribe((status) => {
          // The handshake can finish *after* this component unmounted (fast
          // navigation, or StrictMode's dev double-effect). Cleanup only knows
          // about `channelRef.current`, which a racing connect() never managed to
          // set — so if we are already disposed, tear our own channel down here
          // or it stays subscribed and permanently consumes one of the 200 free
          // realtime connections.
          if (disposed) {
            void supabase.removeChannel(channel);
            return;
          }
          if (status === 'SUBSCRIBED') {
            setConnected(true);
            // Spectators deliberately do NOT track: presence is the thing we cap.
            if (!full) {
              void channel.track({
                name: profile.display_name,
                emoji: profile.avatar_emoji,
                slot: nextTicket.presence.slot,
                joinedAt: new Date().toISOString(),
              });
            }
          }
        });
      } catch (err) {
        if (!disposed) setError(friendlyError(err));
      }
    };

    void connect();

    return () => {
      disposed = true;
      const channel = channelRef.current;
      channelRef.current = null;
      if (channel) {
        void channel.untrack().finally(() => {
          void getBrowserSupabase().removeChannel(channel);
        });
      }
      // Best-effort slot release so the cap reflects reality before the 3-minute
      // TTL expires. `keepalive` keeps it alive through the unload.
      void fetch('/api/realtime', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capsuleId: capsule.id }),
        keepalive: true,
      }).catch(() => undefined);
    };
    // Reconnecting on profile change would duplicate the channel; the profile is
    // stable for a signed-in session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capsule.id]);

  // ── when the seal breaks, everything unlocks itself ─────────────────────
  useEffect(() => {
    if (!broken) return;
    void loadContents();

    // Durable trace of the moment. RLS allows this insert only after unlock,
    // which is exactly right: before unlock it would be a leak.
    void (async () => {
      try {
        const supabase = getBrowserSupabase();
        await supabase.from('realtime_events').insert({
          capsule_id: capsule.id,
          actor_id: profile.id,
          event_type: 'unwrap_seal_broken',
          payload: { at: new Date().toISOString(), source: 'client' },
        });
      } catch {
        /* the party carries on; this row is a nicety */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broken]);

  const presentCount = memberCountFor(members);
  const combined = combinedPull(pulls, presentCount);

  const sendReaction = (emoji: string) => {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    spawnReaction({ emoji, nonce, name: profile.display_name });
    const channel = channelRef.current;
    if (!channel || spectator) return;
    void channel.send({
      type: 'broadcast',
      event: BROADCAST.reaction,
      payload: { emoji, nonce, userId: profile.id, name: profile.display_name } satisfies ReactionMessage,
    });
  };

  const sendPull = (pull: number) => {
    setPulls((prev) => ({ ...prev, [profile.id]: pull }));
    const channel = channelRef.current;
    if (!channel || spectator) return;
    void channel.send({
      type: 'broadcast',
      event: BROADCAST.unwrapProgress,
      payload: {
        userId: profile.id,
        name: profile.display_name,
        pull,
      } satisfies UnwrapProgressMessage,
    });
  };

  const breakSeal = () => {
    setBroken(true);
    const channel = channelRef.current;
    if (!channel) return;
    void channel.send({
      type: 'broadcast',
      event: BROADCAST.sealBroken,
      payload: {
        userId: profile.id,
        name: profile.display_name,
        at: new Date().toISOString(),
      } satisfies SealBrokenMessage,
    });
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 pb-24 pt-6 sm:px-6">
      {/* ── where am I ─────────────────────────────────────────────────── */}
      <header className="text-center">
        <Stamp tone={broken ? 'sage' : 'butter'}>
          {broken ? 'reading room · open' : 'opening party · sealed'}
        </Stamp>
        <h1 className="mt-3 font-script text-4xl leading-tight text-cardboard-deep sm:text-5xl">
          {capsule.cover_emoji} {capsule.title}
        </h1>
        <p className="mt-2 text-[13px] text-ink-soft">
          {spectator ? (
            <>Watching with {presentCount} other{memberPlural(presentCount)} · read-only (the rope is full)</>
          ) : connected ? (
            <>
              {presentCount} {memberPlural(presentCount)} here · {Math.max(0, (ticket?.presence.capacity ?? 20) - presentCount)} more could fit
            </>
          ) : (
            'Knocking on the door…'
          )}
        </p>
        {broken && ceremonyAt ? (
          <p className="mt-1 font-round text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            the seal came off {formatUnlockMoment(ceremonyAt)}
          </p>
        ) : null}
      </header>

      <AnimatePresence>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="rounded-2xl border border-blush-deep/40 bg-blush-light/70 px-4 py-3 text-[13px] text-blush-deep"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {/* ── the unwrap ─────────────────────────────────────────────────── */}
      <UnwrapString
        members={members}
        pulls={pulls}
        combined={broken ? 1 : combined}
        broken={broken}
        onPull={sendPull}
        onBreak={breakSeal}
        canPull={!spectator}
        memberCount={capsule.member_count}
      />

      {/* ── the reaction tray ──────────────────────────────────────────── */}
      <ReactionTray reactions={reactions} onSend={sendReaction} disabled={!connected} />

      <DotDivider className="my-8" />

      {/* ── what was inside ────────────────────────────────────────────── */}
      <section id="capsule-contents" className="scroll-mt-6 space-y-6">
        {!broken ? (
          <div className="relative grid place-items-center rounded-2xl border-2 border-dashed border-cream-300 bg-cream-100 px-6 py-16 text-center">
            <motion.span
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ repeat: Infinity, duration: 3 }}
              className="text-4xl"
            >
              🫙
            </motion.span>
            <p className="mt-3 font-round text-sm font-semibold text-ink">
              Everything is still wrapped
            </p>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-ink-faint">
              {capsule.contribution_count} contribution{capsule.contribution_count === 1 ? '' : 's'} and{' '}
              {capsule.prediction_count} guess{capsule.prediction_count === 1 ? '' : 'es'} are waiting
              behind the wax. The capsule itself is already open — the room is simply not unwrapped
              yet. Pull together and it all comes out at once.
            </p>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-script text-3xl leading-none text-cardboard-deep">the scrapbook</h2>
                <p className="mt-1 text-[13px] text-ink-soft">
                  Everything that was sealed in, in the order it happened.
                </p>
              </div>
              {loadingContents ? <Stamp tone="butter">unsealing…</Stamp> : null}
            </header>

            <ScrapbookGrid contributions={contributions} />

            <DotDivider className="my-8" />

            <PredictionPinboard
              capsuleId={capsule.id}
              profile={profile}
              unlocked
              sealedCount={predictions.length}
              predictions={predictions}
              votes={initialVotes}
              memberCount={capsule.member_count}
            />
          </>
        )}
      </section>

      {!broken ? (
        <p className="text-center text-[11px] text-ink-faint">
          Everybody here holds the twine at once. A rope does not come undone for one pair of hands.
        </p>
      ) : null}

      {!connected ? (
        <div className="flex justify-center">
          <BouncyButton tone="ghost" size="sm" onClick={() => window.location.reload()}>
            reconnect
          </BouncyButton>
        </div>
      ) : null}
    </div>
  );
}

function memberPlural(count: number): string {
  return count === 1 ? 'person' : 'people';
}

/** Present members, ensuring the viewer is counted even before presence syncs. */
function memberCountFor(members: PartyMember[]): number {
  return Math.max(1, members.length);
}
