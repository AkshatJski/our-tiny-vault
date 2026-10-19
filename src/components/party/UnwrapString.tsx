'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame, Stamp, WashiTape } from '@/components/ui/PaperBits';
import { UNWRAP_BREAK_AT } from '@/lib/realtime';
import type { PartyMember } from '@/lib/realtime';
import { clamp, cn } from '@/lib/utils';
import { playPaperTear, playCrinkle } from '@/lib/sound';

const DRAG_RANGE = 230;

/**
 * The cooperative unwrap.
 *
 * Everyone drags their own strand of twine. The seal gives way when the
 * *combined* pull of everyone present covers the rope — which means:
 *   • with four people, each needs ~25% before the wax cracks
 *   • alone at 2am, one person can pull the whole thing (and should be able to)
 *
 * That is `combinedPull()` in lib/realtime.ts, and it is the reason this is a
 * party rather than a button: the seal will not break on its own, and it will not
 * break for one person if others are still holding on.
 */
export function UnwrapString({
  members,
  pulls,
  combined,
  broken,
  onPull,
  onBreak,
  canPull,
}: {
  members: PartyMember[];
  pulls: Record<string, number>;
  combined: number;
  broken: boolean;
  onPull: (pull: number) => void;
  onBreak: () => void;
  canPull: boolean;
}) {
  const reduce = useReducedMotion();
  const [localPull, setLocalPull] = useState(0);
  const brokeRef = useRef(false);
  const lastSentRef = useRef(0);

  const progress = broken ? 1 : clamp(combined, 0, 1);

  const emit = (value: number) => {
    setLocalPull(value);
    // Throttle to ~12/s. A broadcast per animation frame would be 60 messages a
    // second per person, which is rude to a free tier for no visible benefit.
    const now = performance.now();
    if (now - lastSentRef.current < 80 && value < 1) return;
    lastSentRef.current = now;
    onPull(value);
  };

  const maybeBreak = (value: number) => {
    if (broken || brokeRef.current) return;
    if (value >= UNWRAP_BREAK_AT) {
      brokeRef.current = true;
      playPaperTear();
      onBreak();
    }
  };

  /**
   * Somebody else's pull can tip the rope over while you are idle — this is the
   * cooperative case, and it must not depend on *you* being the one dragging.
   */
  useEffect(() => {
    if (broken || brokeRef.current) return;
    if (combined >= UNWRAP_BREAK_AT) {
      brokeRef.current = true;
      playPaperTear();
      onBreak();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combined, broken]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-cream-300 bg-cardboard-light/60 p-5 shadow-paper sm:p-7">
      <SketchyFrame radius={22} stroke="rgba(74,63,53,.28)" />
      <WashiTape className="-top-2 left-1/2 -translate-x-1/2" rotate={2} width={120} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-round text-lg font-bold text-ink">
            {broken ? 'the seal is broken' : 'pull the string together'}
          </h3>
          <p className="text-[12px] leading-relaxed text-ink-soft">
            {broken
              ? 'It is open. Everything that was sealed is about to appear below.'
              : `${members.length} here · drag your tag down and hold on. The wax cracks at 82% of the rope.`}
          </p>
        </div>
        <Stamp tone={broken ? 'sage' : 'cardboard'}>
          {broken ? 'open' : `${Math.round(progress * 100)}% pulled`}
        </Stamp>
      </div>

      {/* ── the parcel ─────────────────────────────────────────────────── */}
      <div className="relative mx-auto grid h-[300px] w-full max-w-md place-items-center">
        {/* twine: two crossings whose dashed offset follows the pull */}
        <svg viewBox="0 0 320 240" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id="boxy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E3C9A9" />
              <stop offset="100%" stopColor="#C89F73" />
            </linearGradient>
          </defs>
          <rect x="42" y="54" width="236" height="150" rx="14" fill="url(#boxy)" stroke="rgba(140,98,57,.55)" strokeWidth="2" />
          <rect x="42" y="54" width="236" height="46" rx="14" fill="rgba(255,255,255,.16)" />
          {/* vertical strand */}
          <motion.line
            x1="160"
            y1="54"
            x2="160"
            y2="204"
            stroke="#FCFBF7"
            strokeWidth="7"
            strokeLinecap="round"
            animate={{ opacity: broken ? 0 : 0.95, pathLength: broken ? 0 : 1 }}
            transition={{ duration: 0.6 }}
            style={{ pathLength: 1 - progress }}
          />
          {/* horizontal strand */}
          <motion.line
            x1="42"
            y1="126"
            x2="278"
            y2="126"
            stroke="#F7E3A1"
            strokeWidth="7"
            strokeLinecap="round"
            animate={{ opacity: broken ? 0 : 0.95 }}
            transition={{ duration: 0.6 }}
            style={{ pathLength: 1 - progress }}
          />
          {/* the wax seal */}
          <motion.circle
            cx="160"
            cy="126"
            r="19"
            fill={broken ? 'transparent' : '#D98C86'}
            stroke="rgba(168,95,90,.8)"
            strokeWidth={broken ? 0 : 2}
            animate={broken ? { r: 30, opacity: 0 } : { r: 19 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
          {!broken ? (
            <text x="160" y="132" textAnchor="middle" fontSize="15" fill="#7A3E39">
              ✦
            </text>
          ) : null}
        </svg>

        {/* ── the pull tag ───────────────────────────────────────────── */}
        {!broken ? (
          <motion.div
            drag={canPull && !reduce ? 'y' : false}
            dragConstraints={{ top: 0, bottom: DRAG_RANGE }}
            dragElastic={0.06}
            dragMomentum={false}
            onDrag={(_, info) => emit(clamp(info.offset.y / DRAG_RANGE, 0, 1))}
            onDragEnd={(_, info) => {
              const value = clamp(info.offset.y / DRAG_RANGE, 0, 1);
              emit(value);
              maybeBreak(value);
              // Deliberately no spring-back: your strand stays stretched where you
              // left it, so the group total can only climb. Snapping back to zero
              // would let one person's release erase what everybody else held.
            }}
            whileTap={canPull && !reduce ? { cursor: 'grabbing' } : undefined}
            className={cn(
              'relative z-10 mt-[168px] select-none',
              canPull ? 'cursor-grab' : 'cursor-not-allowed opacity-60',
            )}
            style={{ touchAction: 'none' }}
          >
            <div className="torn-strip grid h-14 w-28 place-items-center bg-butter shadow-tag">
              <span className="font-round text-[12px] font-bold uppercase tracking-[0.16em] text-cardboard-deep">
                {canPull ? 'pull ↓' : 'watcher'}
              </span>
            </div>
            <span className="mt-1 block text-center text-[11px] text-ink-faint">
              you: {Math.round(localPull * 100)}%
            </span>
          </motion.div>
        ) : (
          <motion.div
            initial={{ scale: 0.7, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 14 }}
            className="relative z-10 mt-[150px] text-center"
          >
            <span className="text-4xl">✂️</span>
            <p className="font-round text-sm font-bold text-cardboard-deep">the knot is undone</p>
          </motion.div>
        )}
      </div>

      {/* ── each person's strand ───────────────────────────────────────── */}
      <div className="mt-4 space-y-2">
        {members.map((member) => {
          const pull = clamp(pulls[member.userId] ?? 0, 0, 1);
          return (
            <div key={member.userId} className="flex items-center gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cream-100 text-[13px]" aria-hidden="true">
                {member.emoji}
              </span>
              <span className="w-24 shrink-0 truncate font-round text-[12px] font-semibold text-ink">
                {member.name}
              </span>
              <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-cream-200">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full bg-sage-deep/70"
                  animate={{ width: `${pull * 100}%` }}
                  transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                />
              </span>
              <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-faint">
                {Math.round(pull * 100)}%
              </span>
            </div>
          );
        })}
        {members.length === 0 ? (
          <p className="text-center text-[12px] text-ink-faint">Waiting for everyone to arrive…</p>
        ) : null}
      </div>

      {/* ── collective bar ─────────────────────────────────────────────── */}
      <div className="mt-5">
        <div className="mb-1 flex justify-between text-[11px] uppercase tracking-[0.14em] text-ink-soft">
          <span>everyone together</span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <div className="relative h-4 overflow-hidden rounded-full border border-cream-300 bg-cream-100">
          <motion.div
            className="h-full rounded-full"
            style={{
              background: broken
                ? 'linear-gradient(90deg,#B9CDB4,#7E9B78)'
                : 'linear-gradient(90deg,#F7E3A1,#F4C7C3)',
            }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ type: 'spring', stiffness: 180, damping: 26 }}
          />
          {/* the crack line everyone is aiming for */}
          <span
            className="absolute inset-y-0 w-[2px] bg-cardboard-deep/60"
            style={{ left: `${UNWRAP_BREAK_AT * 100}%` }}
            aria-hidden="true"
          />
        </div>
      </div>

      {!canPull ? (
        <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-faint">
          Twenty people are already holding this rope. You are watching, and that still counts.
        </p>
      ) : null}

      {broken ? (
        <div className="mt-4 flex justify-center">
          <BouncyButton
            tone="sage"
            onClick={() => {
              playCrinkle(0.4);
              document.getElementById('capsule-contents')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            read it all ↓
          </BouncyButton>
        </div>
      ) : null}
    </div>
  );
}
