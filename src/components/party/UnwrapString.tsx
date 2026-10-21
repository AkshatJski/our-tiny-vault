'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame, Stamp, WashiTape } from '@/components/ui/PaperBits';
import { UNWRAP_BREAK_AT, combinedPull } from '@/lib/realtime';
import type { PartyMember } from '@/lib/realtime';
import { clamp, cn } from '@/lib/utils';
import { playPaperTear } from '@/lib/sound';

const DRAG_RANGE = 110;

/**
 * Where the rope is, in words rather than numbers.
 *
 * The old copy said "82% of the rope" and "you: 48%", which turned a shared
 * moment into a progress dashboard. Nobody standing round a parcel thinks in
 * percentages; they think "it's giving" or "it hasn't moved". These thresholds
 * are the same maths as before — only the telling changed.
 */
const WARM_AT = 0.25;
const CRACK_AT = 0.55;

function groupWord(
  progress: number,
  broken: boolean,
  state: { alone: boolean; allHolding: boolean },
): string {
  if (broken) return 'open';
  if (state.alone && progress > 0.02) return 'needs another hand';
  if (progress >= UNWRAP_BREAK_AT && !state.allHolding) return 'one hand short';
  if (progress >= UNWRAP_BREAK_AT) return 'giving way';
  if (progress >= CRACK_AT) return 'cracking';
  if (progress >= WARM_AT) return 'warming up';
  if (progress > 0.02) return 'a first tug';
  return 'still shut';
}

function handWord(pull: number): string {
  if (pull >= 0.75) return 'holding on';
  if (pull > 0.02) return 'pulling';
  return 'not yet';
}

/**
 * The cooperative unwrap.
 *
 * Everyone drags their own strand of twine. The seal gives way when the
 * *combined* pull of everyone present covers the rope — which means the rope
 * does not break for one person while others are still holding on, and it does
 * break for someone opening a capsule alone at 2am.
 *
 * That is `combinedPull()` in lib/realtime.ts, and it is the reason this is a
 * party rather than a button.
 */
export function UnwrapString({
  members,
  pulls,
  broken,
  onPull,
  onBreak,
  canPull,
  memberCount,
  myUserId,
}: {
  members: PartyMember[];
  pulls: Record<string, number>;
  broken: boolean;
  onPull: (pull: number) => void;
  onBreak: () => void;
  canPull: boolean;
  /** How many people belong to the vault, so "everyone's here" can mean it. */
  memberCount?: number;
  /** Which strand is mine, so my own drag counts immediately — not 80 ms later. */
  myUserId: string;
}) {
  const reduce = useReducedMotion();
  const [localPull, setLocalPull] = useState(0);
  const brokeRef = useRef(false);
  const lastSentRef = useRef(0);

  /**
   * The rope only gives when *every hand in the room* is holding at once.
   *
   * The first version divided the total pull by the number of people present, so
   * one person alone at 2am could pull the whole rope and spend the ceremony by
   * themselves — which is exactly what happened the first time this was tried.
   * A seal that one person can open is not a shared moment.
   *
   * So: at least two people, and every present member at or past the break
   * threshold, *and* the combined pull past it too. My own value is folded in
   * from local state because the parent learns about it one state update later.
   */
  const present = Math.max(1, members.length);
  const myPull = Math.max(pulls[myUserId] ?? 0, localPull);
  const effectivePulls = { ...pulls, [myUserId]: myPull };
  const progress = broken ? 1 : clamp(combinedPull(effectivePulls, present), 0, 1);
  const holding = members.filter(
    (member) => (effectivePulls[member.userId] ?? 0) >= UNWRAP_BREAK_AT,
  ).length;
  const alone = members.length < 2;
  const allHolding = !alone && members.every(
    (member) => (effectivePulls[member.userId] ?? 0) >= UNWRAP_BREAK_AT,
  );
  const stage = groupWord(progress, broken, { alone, allHolding });

  const emit = (value: number) => {
    setLocalPull(value);
    // Throttle to ~12/s. A broadcast per animation frame would be 60 messages a
    // second per person, which is rude to a free tier for no visible benefit.
    const now = performance.now();
    if (now - lastSentRef.current < 80 && value < 1) return;
    lastSentRef.current = now;
    onPull(value);
  };

  /**
   * Somebody else's hand can tip the rope over while you are idle — this is the
   * cooperative case, and it must not depend on *you* being the one dragging.
   */
  useEffect(() => {
    if (broken || brokeRef.current) return;
    if (!allHolding) return;
    if (progress < UNWRAP_BREAK_AT) return;
    brokeRef.current = true;
    playPaperTear();
    onBreak();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allHolding, progress, broken]);

  // The ritual, as three things that either happened or have not.
  const expected = Math.max(1, memberCount ?? members.length);
  const allHere = members.length >= expected;
  const steps: Array<{ label: string; done: boolean }> = [
    { label: allHere ? 'everyone is here' : 'as people arrive', done: allHere },
    {
      label:
        members.length < 2
          ? 'a second hand has to arrive'
          : allHolding
            ? 'every hand on the twine'
            : `${holding} of ${members.length} hands on the twine`,
      done: allHolding,
    },
    { label: 'the wax gives way', done: broken },
  ];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-cream-300 bg-cardboard-light/60 p-5 shadow-paper sm:p-7">
      <SketchyFrame radius={22} stroke="rgba(74,63,53,.28)" />
      <WashiTape className="-top-2 left-1/2 -translate-x-1/2" rotate={2} width={120} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-round text-lg font-bold text-ink">
            {broken ? 'the seal is broken' : 'the opening party'}
          </h3>
          <p className="max-w-sm text-[12px] leading-relaxed text-ink-soft">
            {broken
              ? 'It is open. Everything that was sealed is about to appear below.'
              : alone
                ? 'The twine is here, but it will not give to one pair of hands. Send the link — it opens when everyone is holding at once.'
                : 'Everyone here takes the twine and holds to the end. The wax only gives when every hand in the room is holding at once.'}
          </p>
        </div>
        <Stamp tone={broken ? 'sage' : progress >= CRACK_AT ? 'butter' : 'cardboard'}>{stage}</Stamp>
      </div>

      {/* ── the parcel ─────────────────────────────────────────────────── */}
      <div className="relative mx-auto h-[392px] w-full max-w-md">
        <svg viewBox="0 0 320 240" className="absolute inset-x-0 top-0 mx-auto h-[300px] w-full" aria-hidden="true">
          <defs>
            <linearGradient id="boxy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E3C9A9" />
              <stop offset="100%" stopColor="#C89F73" />
            </linearGradient>
          </defs>
          <rect x="42" y="54" width="236" height="150" rx="14" fill="url(#boxy)" stroke="rgba(140,98,57,.55)" strokeWidth="2" />
          <rect x="42" y="54" width="236" height="46" rx="14" fill="rgba(255,255,255,.16)" />

          {/* vertical strand — pulled taut as the group holds */}
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

          {/* hairline cracks: the wax gives in stages, not all at once */}
          {!broken ? (
            <>
              <motion.path
                d="M150 116 l-9 -8"
                stroke="#8E4A45"
                strokeWidth="1.8"
                strokeLinecap="round"
                animate={{ opacity: progress >= CRACK_AT ? 0.85 : 0 }}
                transition={{ duration: 0.4 }}
              />
              <motion.path
                d="M168 132 l8 9"
                stroke="#8E4A45"
                strokeWidth="1.8"
                strokeLinecap="round"
                animate={{ opacity: progress >= CRACK_AT + 0.12 ? 0.85 : 0 }}
                transition={{ duration: 0.4 }}
              />
              <motion.path
                d="M166 112 l7 -7"
                stroke="#8E4A45"
                strokeWidth="1.6"
                strokeLinecap="round"
                animate={{ opacity: progress >= CRACK_AT + 0.22 ? 0.8 : 0 }}
                transition={{ duration: 0.4 }}
              />
            </>
          ) : null}

          {/* the wax seal */}
          <motion.circle
            cx="160"
            cy="126"
            r="19"
            fill={broken ? 'transparent' : '#D98C86'}
            stroke="rgba(168,95,90,.8)"
            strokeWidth={broken ? 0 : 2}
            animate={broken ? { r: 30, opacity: 0 } : { r: 19 + progress * 3 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
          {!broken ? (
            <motion.text
              x="160"
              y="132"
              textAnchor="middle"
              fontSize="15"
              fill="#7A3E39"
              animate={reduce ? { opacity: 1 } : { opacity: [0.75, 1, 0.75] }}
              transition={reduce ? { duration: 0 } : { repeat: Infinity, duration: 2.6 }}
            >
              ✦
            </motion.text>
          ) : null}
        </svg>

        {/* ── the pull tag ───────────────────────────────────────────── */}
        {!broken ? (
          <div className="absolute left-1/2 top-[196px] z-10 -translate-x-1/2">
            <motion.div
              /**
               * `useReducedMotion` must never gate the drag itself. It reports the
               * operating system's "reduce animation" setting, which is on for
               * plenty of people (and on this machine) — and the first version
               * wired it to `drag`, which left the rope unpullable and the party
               * permanently sealed. Reduced motion means fewer decorative
               * animations, not a disabled hand.
               */
              drag={canPull ? 'y' : false}
              dragConstraints={{ top: 0, bottom: DRAG_RANGE }}
              dragElastic={reduce ? 0 : 0.06}
              dragMomentum={false}
              onDrag={(_, info) => emit(clamp(info.offset.y / DRAG_RANGE, 0, 1))}
              onDragEnd={(_, info) => {
                emit(clamp(info.offset.y / DRAG_RANGE, 0, 1));
                // The break itself is decided by the effect above, from the state
                // of *every* hand — not from how far this one drag went.
                // Deliberately no spring-back: your strand stays stretched where you
                // left it, so the group total can only climb. Snapping back to zero
                // would let one person's release erase what everybody else held.
              }}
              whileTap={canPull ? { cursor: 'grabbing' } : undefined}
              className={cn('select-none', canPull ? 'cursor-grab' : 'cursor-not-allowed opacity-60')}
              style={{ touchAction: 'none' }}
            >
              <div className="torn-strip grid h-14 w-28 place-items-center bg-butter shadow-tag">
                <span className="font-round text-[12px] font-bold uppercase tracking-[0.16em] text-cardboard-deep">
                  {canPull ? 'pull ↓' : 'watcher'}
                </span>
              </div>
              <span className="mt-1 block text-center font-round text-[11px] text-ink-faint">
                {!canPull
                  ? 'watching along'
                  : localPull > 0.02
                    ? handWord(localPull)
                    : alone
                      ? 'pull, and wait for hands'
                      : 'take the twine'}
              </span>
            </motion.div>
          </div>
        ) : (
          <motion.div
            initial={{ scale: 0.7, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 14 }}
            className="absolute inset-x-0 top-[150px] z-10 text-center"
          >
            <span className="text-4xl">✂️</span>
            <p className="font-round text-sm font-bold text-cardboard-deep">the knot is undone</p>
          </motion.div>
        )}
      </div>

      {/* ── the ritual, as three things ────────────────────────────────── */}
      <ol className="mt-2 grid gap-2 sm:grid-cols-3">
        {steps.map((step) => (
          <li
            key={step.label}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-2 font-round text-[11px] font-semibold transition-colors',
              step.done
                ? 'border-sage-deep/40 bg-sage-light/70 text-sage-deep'
                : 'border-dashed border-cream-300 bg-cream-50 text-ink-faint',
            )}
          >
            <span aria-hidden="true" className="text-[12px]">
              {step.done ? '✦' : '○'}
            </span>
            {step.label}
          </li>
        ))}
      </ol>

      {/* ── each person's strand ───────────────────────────────────────── */}
      <div className="mt-5 space-y-2.5">
        {members.map((member) => {
          const pull = clamp(effectivePulls[member.userId] ?? 0, 0, 1);
          return (
            <div key={member.userId} className="flex items-center gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cream-100 text-[13px]" aria-hidden="true">
                {member.emoji}
              </span>
              <span className="w-24 shrink-0 truncate font-round text-[12px] font-semibold text-ink">
                {member.name}
              </span>
              <span className="relative h-[3px] flex-1 rounded-full bg-cream-300/80">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full bg-sage-deep/50"
                  animate={{ width: `${pull * 100}%` }}
                  transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                />
                <motion.span
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-cardboard/50 bg-butter shadow-sm"
                  animate={{ left: `calc(${pull * 100}% - 5px)` }}
                  transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                  aria-hidden="true"
                />
              </span>
              <span className="w-[74px] shrink-0 text-right font-round text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {handWord(pull)}
              </span>
            </div>
          );
        })}
        {members.length === 0 ? (
          <p className="text-center text-[12px] text-ink-faint">Waiting for everyone to arrive…</p>
        ) : null}
      </div>

      {/* ── the seam, inked a stitch at a time ─────────────────────────── */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-ink-soft">
          <span>the whole group</span>
          <span className="font-round text-[11px] normal-case tracking-normal text-ink-soft">{stage}</span>
        </div>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, index) => {
            const inked = progress >= (index + 1) / 14;
            return (
              <span
                key={index}
                className={cn(
                  'h-3.5 flex-1 rounded-[1px] transition-colors duration-300',
                  inked ? (broken ? 'bg-sage-deep/70' : 'bg-blush-deep/60') : 'bg-cardboard/25',
                )}
                style={{ transform: `rotate(${(index % 2 === 0 ? -1 : 1) * 1.4}deg)` }}
              />
            );
          })}
        </div>
      </div>

      {!canPull ? (
        <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-faint">
          The rope is full of hands. Watching is a way of being here too.
        </p>
      ) : null}

      {!broken && alone && localPull > 0.02 ? (
        <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-faint">
          One hand can warm the wax, but it cannot break it. Somebody else has to take
          the other end — send them the link and keep holding.
        </p>
      ) : null}

      {broken ? (
        <div className="mt-4 flex justify-center">
          <BouncyButton
            tone="sage"
            onClick={() => {
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
