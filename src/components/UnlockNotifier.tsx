'use client';

import { useEffect } from 'react';

/**
 * Fires once when an opened vault has not told anyone yet.
 *
 * Deliberately invisible and deliberately quiet: no loading state, no toast, no
 * error surfaced to the reader. The point of the request is to mail *other
 * people*; if it fails, the daily cron still catches them tomorrow, and the
 * person looking at the vault should never see a scary message about a letter
 * going to someone else.
 *
 * The server does the real guarding (membership, unlock time, and a
 * compare-and-swap on `unlocked_notified_at`). This component only decides when
 * it is worth asking.
 */
const pinged = new Set<string>();

export function UnlockNotifier({
  capsuleId,
  enabled,
}: {
  capsuleId: string;
  /** Only true when the vault is open AND nobody has been told yet. */
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled || pinged.has(capsuleId)) return;
    pinged.add(capsuleId);

    void fetch(`/api/capsules/${capsuleId}/notify`, {
      method: 'POST',
      // Cookies carry the session; no body needed.
      credentials: 'same-origin',
    }).catch(() => {
      // Silent by design — see the note above. The cron is the backstop.
    });
  }, [capsuleId, enabled]);

  return null;
}
