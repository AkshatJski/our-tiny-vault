'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { cn } from '@/lib/utils';
import { playPop } from '@/lib/sound';

/**
 * The invite code, on a paper tab, with a copy button.
 *
 * `navigator.clipboard` needs a secure context and can be blocked in in-app
 * browsers, so there is always a visible fallback: the code itself is selectable
 * text, and tapping it selects the whole thing. A copy button that silently does
 * nothing is worse than no copy button.
 */
export function InviteCodeChip({
  code,
  partyUrl,
  className,
}: {
  code: string;
  partyUrl?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      playPop(1.2);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
    window.setTimeout(() => setCopied('idle'), 2200);
  };

  return (
    <div className={cn('relative inline-flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        onClick={() => void copy(code)}
        className="torn-strip group inline-flex items-center gap-2 bg-butter px-4 py-2 shadow-tag"
        title="Copy the invite code"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-cardboard-deep/80">
          invite
        </span>
        <span className="font-mono text-[15px] font-bold tracking-[0.22em] text-cardboard-deep selection:bg-cream-50">
          {code}
        </span>
        <span className="text-[13px] opacity-70 transition-opacity group-hover:opacity-100">⧉</span>
      </button>

      {partyUrl ? (
        <BouncyButton
          size="sm"
          tone="ghost"
          onClick={() => void copy(partyUrl)}
          className="text-[12px]"
        >
          copy party link
        </BouncyButton>
      ) : null}

      <AnimatePresence>
        {copied !== 'idle' ? (
          <motion.span
            initial={{ opacity: 0, y: 4, rotate: -2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-bold',
              copied === 'done'
                ? 'border-sage-deep/40 bg-sage-light text-sage-deep'
                : 'border-blush-deep/40 bg-blush-light text-blush-deep',
            )}
          >
            {copied === 'done' ? 'copied ✦' : 'long-press to copy'}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
