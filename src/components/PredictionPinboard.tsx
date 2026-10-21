'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { PinDot, SketchyFrame, Stamp } from '@/components/ui/PaperBits';
import { ScratchOffResolution } from '@/components/party/ScratchOffResolution';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { sealPrediction } from '@/lib/contributions';
import { castPredictionVote } from '@/lib/votes';
import {
  PROMPT_PACK,
  forgetGuess,
  readGuessLedger,
  rememberGuess,
} from '@/lib/prompts';
import type { PredictionVote, PredictionWithAuthor, Profile } from '@/lib/types';
import { cn, friendlyError, truncate } from '@/lib/utils';
import { playCrinkle, playPop } from '@/lib/sound';

const MAX_PLACEHOLDERS = 24;
const PROMISE_COPY =
  'Nobody can read these before the capsule opens. Not the other members, not the host, and not even you. The database physically refuses to hand them back.';

type PinboardProfile = Pick<Profile, 'id' | 'handle' | 'display_name' | 'avatar_emoji'>;

/**
 * The "Dear Future Us" pinboard.
 *
 * ── THE AWKWARD CONSEQUENCE OF OUR OWN RULE ─────────────────────────────────
 * Because `prediction_responses` is unreadable before unlock, the server cannot
 * tell this component:
 *     "you already answered prompt #3"
 * That would be a read. So the client keeps its own ledger in localStorage
 * (`readGuessLedger`) purely to grey out prompts you have already used. It is a
 * UI memory, not an authority — the unique index in Postgres is the authority,
 * and a duplicate attempt fails silently as "already saved".
 *
 * Before unlock the board shows *counts*, never content: sealed slips whose
 * number comes from `capsules.prediction_count`, a column maintained by trigger.
 * Even the placeholder count is metadata, not a read of the guesses.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function PredictionPinboard({
  capsuleId,
  profile,
  unlocked,
  sealedCount,
  predictions,
  votes,
  memberCount,
  onSealed,
}: {
  capsuleId: string;
  profile: PinboardProfile;
  unlocked: boolean;
  sealedCount: number;
  predictions: PredictionWithAuthor[];
  /** Votes already cast, seeded by the server (empty before unlock — by policy). */
  votes?: PredictionVote[];
  /** How many people are in the vault: the denominator for "waiting on N". */
  memberCount?: number;
  onSealed?: (prediction: PredictionWithAuthor) => void;
}) {
  const [allVotes, setAllVotes] = useState<PredictionVote[]>(votes ?? []);
  const members = Math.max(memberCount ?? 0, 1);

  /**
   * Optimistic on purpose: a vote is a tiny, reversible thing, and waiting on a
   * round-trip before the bar moves makes the room feel dead. If the write is
   * refused (sealed capsule, policy, network) we put the old list back and let
   * the slip show the error.
   */
  const castVote = async (predictionId: string, value: boolean) => {
    const previous = allVotes;
    const mine = previous.find(
      (vote) => vote.prediction_id === predictionId && vote.user_id === profile.id,
    );

    const optimistic: PredictionVote = {
      prediction_id: predictionId,
      user_id: profile.id,
      vote: value,
      created_at: mine?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setAllVotes((prev) => [
      ...prev.filter(
        (vote) => !(vote.prediction_id === predictionId && vote.user_id === profile.id),
      ),
      optimistic,
    ]);

    try {
      const supabase = getBrowserSupabase();
      await castPredictionVote(supabase, { predictionId, userId: profile.id, vote: value });
      playPop(value ? 1.2 : 0.8);
    } catch (error) {
      setAllVotes(previous);
      throw error;
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-script text-3xl leading-none text-cardboard-deep">Dear Future Us</h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-soft">
            {unlocked
              ? 'Scratch each slip to read what we expected would happen. Then vote — everybody gets a say, and you can change your mind.'
              : 'Pin a guess to the board. It stays sealed — and unreadable — until the capsule opens.'}
          </p>
        </div>
        <Stamp tone={unlocked ? 'sage' : 'cardboard'}>
          {unlocked
            ? `${predictions.length} guess${predictions.length === 1 ? '' : 'es'}`
            : `${sealedCount} sealed guess${sealedCount === 1 ? '' : 'es'}`}
        </Stamp>
      </header>

      <div className="relative rounded-3xl border-4 border-cardboard/70 cork p-5 sm:p-7">
        <SketchyFrame radius={22} stroke="rgba(74,63,53,.3)" />

        {unlocked ? (
          predictions.length === 0 ? (
            <p className="py-10 text-center font-round text-sm text-cream-100/90">
              Nobody was brave enough to guess. Rude, honestly.
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {predictions.map((prediction, index) => (
                <RevealedSlip
                  key={prediction.id}
                  prediction={prediction}
                  index={index}
                  votes={allVotes.filter((vote) => vote.prediction_id === prediction.id)}
                  myVote={
                    allVotes.find(
                      (vote) =>
                        vote.prediction_id === prediction.id && vote.user_id === profile.id,
                    )?.vote ?? null
                  }
                  memberCount={members}
                  onVote={castVote}
                />
              ))}
            </div>
          )
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: Math.min(sealedCount, MAX_PLACEHOLDERS) }).map((_, index) => (
                <SealedSlip key={`sealed-${index}`} index={index} />
              ))}
              {sealedCount === 0 ? (
                <p className="col-span-full py-8 text-center font-round text-sm text-cream-100">
                  The board is empty. Be the first to guess something ridiculous.
                </p>
              ) : null}
            </div>

            {sealedCount > MAX_PLACEHOLDERS ? (
              <p className="mt-4 text-center text-[11px] text-cream-100/80">
                …and {sealedCount - MAX_PLACEHOLDERS} more slips pinned out of view.
              </p>
            ) : null}

            <p className="mt-6 rounded-2xl bg-cream-100/95 px-4 py-3 text-[11px] leading-relaxed text-ink-soft">
              🔒 {PROMISE_COPY}
            </p>
          </>
        )}
      </div>

      {!unlocked ? (
        <GuessComposer capsuleId={capsuleId} profile={profile} onSealed={onSealed} />
      ) : null}
    </section>
  );
}

/** A slip you cannot read yet. Shape and number only. */
function SealedSlip({ index }: { index: number }) {
  const tilt = [-4, 2.5, -1.5, 3.5, -2.5, 1.5][index % 6];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, rotate: tilt - 4 }}
      animate={{ opacity: 1, y: 0, rotate: tilt }}
      transition={{ delay: Math.min(index * 0.045, 0.6), type: 'spring', stiffness: 240, damping: 20 }}
      whileHover={{ rotate: 0, scale: 1.03, y: -3 }}
      className="relative min-h-[112px] rounded-sm bg-cream-100 px-4 py-5 shadow-paper"
    >
      <PinDot className="-top-2 left-1/2 -translate-x-1/2" />
      <div className="space-y-2.5 blur-[3px]" aria-hidden="true">
        <div className="h-2.5 w-3/4 rounded-full bg-ink/20" />
        <div className="h-2.5 w-full rounded-full bg-ink/15" />
        <div className="h-2.5 w-2/3 rounded-full bg-ink/15" />
      </div>
      <span className="absolute bottom-2 right-3 font-round text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        sealed
      </span>
    </motion.div>
  );
}

/**
 * A guess, revealed and scratchable — and now voted on.
 *
 * The old version had one destructive stamp: first click won, everyone else was
 * locked out. This one is a poll. Your own vote is highlighted, you can switch
 * it, and the slip always says how much of the group has spoken, because "3 of 5
 * voted" is the difference between a decision and a shrug.
 */
function RevealedSlip({
  prediction,
  index,
  votes,
  myVote,
  memberCount,
  onVote,
}: {
  prediction: PredictionWithAuthor;
  index: number;
  votes: PredictionVote[];
  myVote: boolean | null;
  memberCount: number;
  onVote: (predictionId: string, value: boolean) => Promise<void>;
}) {
  const tilt = [-3, 2, -1, 3, -2, 1][index % 6];
  const [busy, setBusy] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const author = prediction.author;

  const cast = votes.length;
  const yes = votes.filter((vote) => vote.vote).length;
  const no = cast - yes;
  const yesPercent = cast === 0 ? 0 : Math.round((yes / cast) * 100);
  const waiting = Math.max(0, memberCount - cast);

  const verdict: 'yes' | 'no' | 'tie' | null =
    cast === 0 ? null : yes > no ? 'yes' : no > yes ? 'no' : 'tie';

  const vote = async (value: boolean) => {
    setBusy(value);
    setError(null);
    try {
      await onVote(prediction.id, value);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, rotate: tilt - 4 }}
      animate={{ opacity: 1, y: 0, rotate: tilt }}
      transition={{ delay: Math.min(index * 0.05, 0.7), type: 'spring', stiffness: 240, damping: 20 }}
      whileHover={{ rotate: 0, y: -3 }}
      className="relative rounded-sm bg-cream-100 px-4 pb-4 pt-6 shadow-paper-lift"
    >
      <PinDot className="-top-2 left-6" />

      <p className="font-round text-[11px] font-bold uppercase tracking-[0.14em] text-cardboard-deep">
        {truncate(prediction.prompt_text, 70)}
      </p>

      <div className="mt-2 rounded-lg border border-dashed border-cream-300 bg-cream-50 p-3">
        <ScratchOffResolution className="min-h-[68px]" onRevealed={() => playCrinkle(0.4)}>
          <p className="font-sketch text-[14px] leading-6 text-ink">{prediction.guess}</p>
        </ScratchOffResolution>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-cream-200 text-[11px]" aria-hidden="true">
          {author?.avatar_emoji ?? '🫧'}
        </span>
        <span className="font-round text-[12px] font-semibold text-ink-soft">
          {author?.display_name ?? 'someone'}
        </span>
        <span className="ml-auto">
          {verdict === 'yes' ? <Stamp tone="sage">called it ✦</Stamp> : null}
          {verdict === 'no' ? <Stamp tone="blush">not quite</Stamp> : null}
          {verdict === 'tie' ? <Stamp tone="butter">split down the middle</Stamp> : null}
          {verdict === null ? <Stamp tone="cardboard">no votes yet</Stamp> : null}
        </span>
      </div>

      {/* The tally. Two colours, one bar: the argument itself, made visible. */}
      <div className="mt-3">
        <div
          className="flex h-2 overflow-hidden rounded-full bg-cream-300"
          role="img"
          aria-label={
            cast === 0
              ? 'no votes yet'
              : `${yes} said yes, ${no} said no, ${waiting} still to vote`
          }
        >
          <div className="bg-sage-deep transition-[width] duration-500" style={{ width: `${yesPercent}%` }} />
          <div
            className="bg-blush-deep/70 transition-[width] duration-500"
            style={{ width: `${100 - yesPercent}%` }}
          />
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px] text-ink-faint">
          <span>
            {cast === 0
              ? 'nobody has voted'
              : `${yesPercent}% said yes · ${yes} of ${cast}`}
          </span>
          <span>{waiting === 0 ? 'everyone voted' : `waiting on ${waiting}`}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void vote(true)}
          disabled={busy !== null || myVote === true}
          aria-pressed={myVote === true}
          className={cn(
            'rounded-full border px-3 py-2 font-round text-[12px] font-semibold transition-colors',
            myVote === true
              ? 'border-sage-deep bg-sage-light text-sage-deep'
              : 'border-cream-300 bg-cream-50 text-ink-soft hover:bg-cream-200',
          )}
        >
          {busy === true ? '…' : myVote === true ? '✓ yes it happened' : 'yes it happened'}
        </button>
        <button
          type="button"
          onClick={() => void vote(false)}
          disabled={busy !== null || myVote === false}
          aria-pressed={myVote === false}
          className={cn(
            'rounded-full border px-3 py-2 font-round text-[12px] font-semibold transition-colors',
            myVote === false
              ? 'border-blush-deep bg-blush-light text-blush-deep'
              : 'border-cream-300 bg-cream-50 text-ink-soft hover:bg-cream-200',
          )}
        >
          {busy === false ? '…' : myVote === false ? '✓ no it did not' : 'no it did not'}
        </button>
      </div>

      {myVote !== null ? (
        <p className="mt-2 text-center text-[11px] text-ink-faint">
          your vote — tap the other one to change it
        </p>
      ) : null}

      {error ? <p className="mt-2 text-[11px] text-blush-deep">{error}</p> : null}
    </motion.div>
  );
}

/** Where a sealed guess gets written. */
function GuessComposer({
  capsuleId,
  profile,
  onSealed,
}: {
  capsuleId: string;
  profile: PinboardProfile;
  onSealed?: (prediction: PredictionWithAuthor) => void;
}) {
  const [ledger, setLedger] = useState<string[]>(() => readGuessLedger(capsuleId));
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const answered = useMemo(() => new Set(ledger), [ledger]);
  const activePrompt = PROMPT_PACK.find((prompt) => prompt.key === activeKey) ?? null;
  const remaining = PROMPT_PACK.length - answered.size;

  const submit = async () => {
    if (!activePrompt) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = getBrowserSupabase();
      const prediction = await sealPrediction(
        supabase,
        {
          capsuleId,
          authorId: profile.id,
          promptKey: activePrompt.key,
          promptText: activePrompt.text,
          guess,
        },
        {
          id: profile.id,
          handle: profile.handle,
          display_name: profile.display_name,
          avatar_emoji: profile.avatar_emoji,
        },
      );
      rememberGuess(capsuleId, activePrompt.key);
      setLedger(readGuessLedger(capsuleId));
      onSealed?.(prediction);
      playCrinkle(0.5);
      setToast('Pinned. Sealed. Unreadable until the capsule opens.');
      setGuess('');
      setActiveKey(null);
    } catch (err) {
      const message = friendlyError(err);
      if (/already saved/i.test(message)) {
        // Lost the localStorage ledger but the DB remembers. Rebuild it locally.
        if (activePrompt) rememberGuess(capsuleId, activePrompt.key);
        setLedger(readGuessLedger(capsuleId));
        setToast('You had already answered that one. The board remembered.');
        setActiveKey(null);
        setGuess('');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-paper">
      <SketchyFrame radius={16} soft stroke="rgba(74,63,53,.2)" />

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-round text-base font-bold text-ink">pin a guess</h3>
        <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {answered.size} of {PROMPT_PACK.length} answered
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {PROMPT_PACK.map((prompt) => {
          const done = answered.has(prompt.key);
          const active = activeKey === prompt.key;
          return (
            <button
              key={prompt.key}
              type="button"
              onClick={() => {
                if (done) {
                  if (window.confirm('You already answered this on this device. Answer again anyway? (It will be refused by the vault.)')) {
                    forgetGuess(capsuleId, prompt.key);
                    setLedger(readGuessLedger(capsuleId));
                  }
                  return;
                }
                setActiveKey(active ? null : prompt.key);
                setGuess('');
                setError(null);
              }}
              className={cn(
                'rounded-full border px-3 py-1.5 text-left font-round text-[12px] font-semibold transition-colors',
                done
                  ? 'border-sage-deep/40 bg-sage-light text-sage-deep'
                  : active
                    ? 'border-cardboard/60 bg-butter text-cardboard-deep'
                    : 'border-cream-300 bg-cream-100 text-ink-soft hover:bg-cream-200',
              )}
              aria-pressed={active}
            >
              {done ? '✓ ' : ''}
              {prompt.text}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {activePrompt ? (
          <motion.div
            key={activePrompt.key}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="overflow-hidden"
          >
            <div className="mt-4 border-t border-dashed border-cream-300 pt-4">
              <label htmlFor="guess" className="field-label">
                {activePrompt.text}
              </label>
              <textarea
                id="guess"
                rows={2}
                maxLength={280}
                value={guess}
                onChange={(event) => setGuess(event.target.value.slice(0, 280))}
                placeholder="Be specific. Your future self is judging."
                className="field resize-none paper-ruled leading-7"
              />
              <div className="mt-1 flex items-center justify-between">
                <p className="text-[11px] text-ink-faint">{activePrompt.nudge}</p>
                <p className="text-[11px] text-ink-faint">{guess.length}/280</p>
              </div>
              <div className="mt-3 flex gap-2">
                <BouncyButton
                  size="sm"
                  tone="butter"
                  disabled={guess.trim().length < 2}
                  loading={busy}
                  onClick={() => void submit()}
                >
                  pin it 🔒
                </BouncyButton>
                <BouncyButton size="sm" tone="ghost" onClick={() => setActiveKey(null)}>
                  cancel
                </BouncyButton>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {remaining === 0 ? (
        <p className="mt-4 text-[11px] text-sage-deep">
          Every prompt answered on this device. Nothing left to guess — which is its own kind of
          answer.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl border border-blush-deep/40 bg-blush-light/70 px-3 py-2 text-xs text-blush-deep" role="alert">
          {error}
        </p>
      ) : null}

      <AnimatePresence>
        {toast ? (
          <motion.p
            key={toast}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 rounded-xl border border-sage-deep/40 bg-sage-light/70 px-3 py-2 text-xs text-sage-deep"
          >
            {toast}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
