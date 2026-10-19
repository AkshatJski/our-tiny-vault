'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { playPop, unlockAudio } from '@/lib/sound';

type Tone = 'blush' | 'butter' | 'sage' | 'cardboard' | 'ink' | 'ghost';

const TONES: Record<Tone, string> = {
  blush: 'bg-blush text-ink border-blush-deep/50 hover:bg-blush-light',
  butter: 'bg-butter text-ink border-butter-deep/60 hover:bg-butter-light',
  sage: 'bg-sage text-ink border-sage-deep/50 hover:bg-sage-light',
  cardboard: 'bg-cardboard-light text-cardboard-deep border-cardboard/60 hover:bg-cream-200',
  ink: 'bg-ink text-cream-100 border-ink hover:bg-ink-soft',
  ghost: 'bg-transparent text-ink-soft border-ink/25 hover:bg-cream-200/70',
};

export interface BouncyButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'> {
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  /** Play the little paper pop when pressed. */
  sound?: boolean;
  loading?: boolean;
}

/**
 * Press me and I squish, then spring back. That is the whole interaction model.
 *
 * Implementation notes:
 *   • whileTap/whileHover live on a motion.button, so the DOM stays a real button
 *     and keyboard/screen-reader behaviour is untouched.
 *   • `sound` is opt-in per instance and silent unless the user enabled audio,
 *     which respects both autoplay policy and everyone's patience.
 */
export function BouncyButton({
  children,
  tone = 'blush',
  size = 'md',
  sound = true,
  loading = false,
  className,
  onClick,
  disabled,
  type = 'button',
  ...rest
}: BouncyButtonProps) {
  const reduce = useReducedMotion();

  const sizes = {
    sm: 'px-3.5 py-2 text-[13px] gap-1.5',
    md: 'px-5 py-2.5 text-[15px] gap-2',
    lg: 'px-7 py-3.5 text-base gap-2.5',
  } as const;

  return (
    <motion.button
      type={type}
      disabled={disabled || loading}
      whileHover={reduce || disabled ? undefined : { scale: 1.035, y: -1 }}
      whileTap={reduce || disabled ? undefined : { scale: 0.945, y: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 18, mass: 0.5 }}
      onClick={(event) => {
        if (sound) {
          void unlockAudio().then(() => playPop(1 + Math.random() * 0.15));
        }
        onClick?.(event);
      }}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-full border-2 font-round font-semibold',
        'shadow-[0_3px_0_0_rgba(74,63,53,0.18)] active:shadow-none',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        sizes[size],
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </motion.button>
  );
}

function Spinner() {
  return (
    <motion.span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
    />
  );
}
