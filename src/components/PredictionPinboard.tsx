'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { PinDot, SketchyFrame, Stamp } from '@/components/ui/PaperBits';
import { ScratchOffResolution } from '@/components/party/ScratchOffResolution';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { resolvePrediction, sealPrediction } from '@/lib/contributions';
import {
  PROMPT_PACK,
  forgetGuess,
  readGuessLedger,
  rememberGuess,
} from '@/lib/prompts';
import type { PredictionWithAuthor, Profile } from '@/lib/types';
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
  onSealed,
  onResolved,
}: {
  capsuleId: string;
  profile: PinboardProfile;
  unlocked: boolean;
  sealedCount: number;
  predictions: PredictionWithAuthor[];
  onSealed?: (prediction: PredictionWithAuthor) => void;
  onResolved?: (predictionId: string, isCorrect: boolean) => void;
}) {
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-script text-3xl leading-none text-cardboard-deep">Dear Future Us</h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-soft">
            {unlocked
              ? 'Every guess, unsealed at last. Scratch each one off to see what we thought would happen.'
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
                  viewerId={profile.id}
                  onResolved={onResolved}
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

/** A guess, revealed and scratchable. */
function RevealedSlip({
  prediction,
  index,
  viewerId,
  onResolved,
}: {
  prediction: PredictionWithAuthor;
  index: number;
  viewerId: string;
  onResolved?: (predictionId: string, isCorrect: boolean) => void;
}) {
  const tilt = [-3, 2, -1, 3, -2, 1][index % 6];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const author = prediction.author;

  const resolved = prediction.is_correct !== null;

  const stamp = async (isCorrect: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const supabase = getBrowserSupabase();
      await resolvePrediction(supabase, prediction.id, viewerId, {
        resolvedGuess: prediction.guess,
        isCorrect,
      });
      playPop(isCorrect ? 1.25 : 0.8);
      onResolved?.(prediction.id, isCorrect);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
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
        {resolved ? (
          <p className="font-sketch text-[14px] leading-6 text-ink">{prediction.guess}</p>
        ) : (
          <ScratchOffResolution className="min-h-[68px]" onRevealed={() => playCrinkle(0.4)}>
            <p className="font-sketch text-[14px] leading-6 text-ink">{prediction.guess}</p>
          </ScratchOffResolution>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-cream-200 text-[11px]" aria-hidden="true">
          {author?.avatar_emoji ?? '🫧'}
        </span>
        <span className="font-round text-[12px] font-semibold text-ink-soft">
          {author?.display_name ?? 'someone'}
        </span>
        <span className="ml-auto">
          {resolved ? (
            <Stamp tone={prediction.is_correct ? 'sage' : 'blush'}>
              {prediction.is_correct ? 'called it ✦' : 'not quite'}
            </Stamp>
          ) : null}
        </span>
      </div>

      {!resolved ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">did it happen?</span>
          <BouncyButton size="sm" tone="sage" loading={busy} onClick={() => void stamp(true)}>
            yes
          </BouncyButton>
          <BouncyButton size="sm" tone="ghost" loading={busy} onClick={() => void stamp(false)}>
            no
          </BouncyButton>
        </div>
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
