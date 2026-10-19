'use client';

import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * The house card. Slight rotation per instance (seeded by `seed`) so a grid of
 * these reads as a scrapbook rather than a table.
 *
 * The spring is deliberately over-damped-ish and slow (stiffness 260, damping 22):
 * bouncy enough to feel handmade, not so bouncy it looks like a loading spinner.
 */
export interface PaperCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: React.ReactNode;
  tilt?: number;
  lift?: boolean;
  seed?: string;
  className?: string;
}

export function PaperCard({
  children,
  tilt = 0,
  lift = true,
  seed,
  className,
  style,
  ...rest
}: PaperCardProps) {
  const reduce = useReducedMotion();
  const rotation = seed ? deterministicTilt(seed) : tilt;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14, rotate: rotation - 1.5 }}
      animate={reduce ? {} : { opacity: 1, y: 0, rotate: rotation }}
      whileHover={reduce || !lift ? undefined : { y: -5, rotate: rotation * 0.4, scale: 1.012 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22, mass: 0.7 }}
      className={cn(
        'relative rounded-2xl border border-cream-300 bg-cream-50 shadow-paper',
        className,
      )}
      style={style}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

function deterministicTilt(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const unit = ((hash >>> 0) % 1000) / 1000; // 0..1
  return (unit * 2 - 1) * 1.8; // -1.8deg .. +1.8deg
}
