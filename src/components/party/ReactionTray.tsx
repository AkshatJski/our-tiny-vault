'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { REACTION_EMOJI } from '@/lib/realtime';
import { cn, seededUnit } from '@/lib/utils';
import { playPop, unlockAudio } from '@/lib/sound';

export interface FloatingReaction {
  id: string;
  emoji: string;
  from: string;
  /** 0..1 across the viewport width, decided at spawn time. */
  lane: number;
}

/**
 * The reaction tray.
 *
 * Reactions are pure broadcast messages — they never touch a table, so a hundred
 * of them cost nothing. The floating layer is `position: fixed` with
 * `pointer-events: none` so it can drift over the whole page without stealing
 * clicks from the scratch-off cards underneath.
 *
 * Each emoji gets a deterministic lane from its id, which stops two simultaneous
 * reactions from stacking into an unreadable blob.
 */
export function ReactionTray({
  reactions,
  onSend,
  disabled = false,
  className,
}: {
  reactions: FloatingReaction[];
  onSend: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <>
      {/* the floating layer */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
        <AnimatePresence>
          {reactions.map((reaction) => {
            const left = 8 + reaction.lane * 84;
            const drift = (seededUnit(reaction.id) - 0.5) * 90;
            return (
              <motion.span
                key={reaction.id}
                initial={{ opacity: 0, y: 0, scale: 0.5, x: 0 }}
                animate={
                  reduce
                    ? { opacity: [0, 1, 1, 0], y: -120, scale: 1 }
                    : { opacity: [0, 1, 1, 0], y: -280 - seededUnit(reaction.id + 'y') * 160, x: drift, scale: [0.5, 1.35, 1.1] }
                }
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: reduce ? 1.2 : 2.6, ease: 'easeOut', times: reduce ? undefined : [0, 0.12, 0.7, 1] }}
                className="absolute bottom-24 text-4xl drop-shadow-[0_4px_10px_rgba(74,63,53,.35)] sm:text-5xl"
                style={{ left: `${left}%` }}
              >
                {reaction.emoji}
              </motion.span>
            );
          })}
        </AnimatePresence>
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-cream-300 bg-cream-50/95 px-3 py-2.5 shadow-paper backdrop-blur',
          className,
        )}
        role="group"
        aria-label="Reactions"
      >
        {REACTION_EMOJI.map((emoji) => (
          <motion.button
            key={emoji}
            type="button"
            disabled={disabled}
            whileHover={reduce ? undefined : { scale: 1.18, y: -3 }}
            whileTap={reduce ? undefined : { scale: 0.86 }}
            transition={{ type: 'spring', stiffness: 520, damping: 16 }}
            onClick={() => {
              void unlockAudio().then(() => playPop(1 + Math.random() * 0.3));
              onSend(emoji);
            }}
            className="reaction-pill disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </motion.button>
        ))}
      </div>
    </>
  );
}
