'use client';

import { useEffect } from 'react';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame } from '@/components/ui/PaperBits';

/**
 * The error boundary.
 *
 * It shows a plain sentence and a retry, and it logs the digest so a Vercel log
 * search can find the real stack. No stack trace in the UI: this is an app about
 * keeping things private, and error text is often the most leaky surface there is.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[our tiny vault] render error', error.digest ?? '', error.message);
  }, [error]);

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center px-5">
      <div className="relative w-full rounded-3xl border border-cream-300 bg-cream-50 p-9 text-center shadow-paper">
        <SketchyFrame radius={22} soft stroke="rgba(74,63,53,.2)" />
        <span className="text-4xl">🩹</span>
        <h1 className="mt-3 font-round text-2xl font-bold text-ink">Something came unstuck</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          Nothing you sealed was lost — the vault either saved it or refused it completely, never
          halfway. Try again, and if it keeps happening the error digest is in the browser console.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-ink-faint">digest {error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <BouncyButton tone="blush" onClick={reset}>
            try again
          </BouncyButton>
          <BouncyButton tone="ghost" onClick={() => window.location.assign('/capsules')}>
            back to the shelf
          </BouncyButton>
        </div>
      </div>
    </main>
  );
}
