'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { countdownTo, pad2 } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { playChime } from '@/lib/sound';

/**
 * The "days left" tag, hanging from a bit of string.
 *
 * Two details that matter:
 *   1. It ticks every second, but the *big* number is days. A capsule two years
 *      out should read "731", not a blur of seconds. The seconds are there for
 *      the last day only, when they finally mean something.
 *   2. Hydration: the server cannot know the client's clock, so the first render
 *      is a neutral placeholder. A mismatch here would make React throw away the
 *      whole tree, which on a slow phone is a visible flash.
 */
export function CountdownTag({
  unlockAt,
  className,
  onUnlock,
  size = 'md',
}: {
  unlockAt: string;
  className?: string;
  onUnlock?: () => void;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [now, setNow] = useState<number | null>(null);
  const firedRef = useRef(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const parts = useMemo(() => (now === null ? null : countdownTo(unlockAt, now)), [unlockAt, now]);

  useEffect(() => {
    if (!parts?.unlocked || firedRef.current) return;
    firedRef.current = true;
    playChime();
    onUnlock?.();
  }, [parts?.unlocked, onUnlock]);

  const scale = {
    sm: { day: 'text-3xl', label: 'text-[10px]', sub: 'text-[11px]' },
    md: { day: 'text-5xl sm:text-6xl', label: 'text-[11px]', sub: 'text-xs' },
    lg: { day: 'text-6xl sm:text-7xl', label: 'text-xs', sub: 'text-sm' },
  }[size];

  if (!parts) {
    // Neutral placeholder, same footprint as the real tag.
    return (
      <div className={cn('torn-tag grid h-40 w-40 place-items-center bg-cream-50', className)}>
        <span className="font-round text-3xl text-ink-faint">· · ·</span>
      </div>
    );
  }

  if (parts.unlocked) {
    return (
      <motion.div
        initial={reduce ? false : { rotate: -2, scale: 0.96 }}
        animate={reduce ? {} : { rotate: [-1.5, 1, -1.5], scale: 1 }}
        transition={{ rotate: { repeat: Infinity, duration: 4.5, ease: 'easeInOut' }, scale: { type: 'spring', stiffness: 220, damping: 16 } }}
        className={cn(
          'torn-tag relative grid h-40 w-40 place-items-center bg-butter text-center',
          'shadow-tag',
          className,
        )}
      >
        <span className="text-3xl">🕯️</span>
        <span className="font-round text-lg font-bold uppercase tracking-[0.14em] text-cardboard-deep">
          it&apos;s open
        </span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-cardboard-deep/70">come in</span>
      </motion.div>
    );
  }

  const nearlyThere = parts.days === 0;

  return (
    <div className={cn('relative', className)}>
      {/* the string it hangs from */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute -top-7 left-1/2 h-8 w-16 -translate-x-1/2"
        viewBox="0 0 64 32"
        fill="none"
      >
        <path
          d="M8 0 C 20 10, 24 22, 31 30 C 38 22, 42 10, 55 0"
          stroke="rgba(140,98,57,.55)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="3 3"
        />
      </svg>

      <motion.div
        whileHover={reduce ? undefined : { rotate: [0, -1.6, 1.2, 0], transition: { duration: 0.8 } }}
        className="torn-tag relative grid h-40 w-40 place-items-center overflow-hidden bg-butter px-3 text-center shadow-tag"
      >
        {/* paper grain on the tag itself */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'80\' height=\'80\'%3E%3Cfilter id=\'g\'%3E%3CfeTurbulence baseFrequency=\'.8\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'80\' height=\'80\' filter=\'url(%23g)\' opacity=\'.09\'/%3E%3C/svg%3E")' }}
        />
        <span className={cn('relative mb-0.5 font-bold uppercase tracking-[0.22em] text-cardboard-deep/80', scale.label)}>
          {nearlyThere ? 'today is the day' : 'days left'}
        </span>
        <span className={cn('relative font-round font-bold leading-none text-cardboard-deep', scale.day)}>
          {nearlyThere ? '0' : parts.days}
        </span>
        <span className={cn('relative mt-1 font-round text-cardboard-deep/80 tabular-nums', scale.sub)}>
          {nearlyThere
            ? `${pad2(parts.hours)}:${pad2(parts.minutes)}:${pad2(parts.seconds)}`
            : `${parts.hours}h ${pad2(parts.minutes)}m`}
        </span>
      </motion.div>
    </div>
  );
}

/** Compact horizontal variant for lists and headers. */
export function CountdownInline({ unlockAt, className }: { unlockAt: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000); // 30s is plenty here
    return () => window.clearInterval(id);
  }, []);

  if (now === null) return <span className={cn('text-ink-faint', className)}>—</span>;
  const parts = countdownTo(unlockAt, now);

  return (
    <span className={cn('tabular-nums', className)}>
      {parts.unlocked
        ? 'open'
        : parts.days > 0
          ? `${parts.days}d ${parts.hours}h`
          : `${parts.hours}h ${pad2(parts.minutes)}m`}
    </span>
  );
}
