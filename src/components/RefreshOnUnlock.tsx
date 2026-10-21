'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Renders nothing. Refreshes the server component tree the moment a capsule's
 * `unlock_at` arrives.
 *
 * Why this exists: whether a capsule is open is decided on the server from the
 * database clock (the UI must never be the authority — see 0002_rls.sql). But a
 * server-rendered page is a photograph: somebody sitting on the shelf at 23:59
 * would stare at a "sealed" card forever unless something asked the server
 * again.
 *
 * So: one timer, one refresh, no polling. The countdown tag already flips to
 * "it's open" locally; this makes the rest of the page agree with it — the
 * scrapbook appears, the composer disappears, the shelf banner shows up.
 *
 * `setTimeout` is clamped by browsers to ~24.8 days. Anything further out just
 * gets a plain re-check on the next visit, which is fine: nobody is watching a
 * tab for a month.
 */
export function RefreshOnUnlock({ unlockAt }: { unlockAt: string | string[] }) {
  const router = useRouter();
  const firedRef = useRef(false);

  // A shelf can hold several capsules; take the soonest one that has not passed.
  const targets = (Array.isArray(unlockAt) ? unlockAt : [unlockAt])
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  const next = targets
    .filter((target) => target > Date.now())
    .sort((a, b) => a - b)[0];

  // Stable primitive dependency — a new array identity every render would
  // otherwise re-arm the timer forever.
  const delay = next === undefined ? null : Math.min(next - Date.now() + 1500, 2_147_000_000);

  useEffect(() => {
    if (delay === null || firedRef.current) return;
    const id = window.setTimeout(() => {
      firedRef.current = true;
      router.refresh();
    }, Math.max(0, delay));
    return () => window.clearTimeout(id);
  }, [delay, router]);

  return null;
}
