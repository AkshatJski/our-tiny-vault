'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { joinCapsuleByCode } from '@/app/capsules/actions';

/**
 * Paste an invite code, land in the capsule.
 *
 * The code check happens in a SECURITY DEFINER function on the database, not
 * here — this component only decides what to display. A wrong code comes back as
 * a sentence, and a full capsule comes back as "this capsule is full (20 of 20)",
 * both of which the user can actually act on.
 */
export function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await joinCapsuleByCode(code);
      if (!result.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }
      router.push(`/capsules/${result.data?.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 rounded-2xl border border-cream-300 bg-cream-50 p-4 shadow-paper sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="invite" className="field-label">
            have an invite code?
          </label>
          <input
            id="invite"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 12))}
            placeholder="e.g. 8F2A9C1D"
            autoComplete="off"
            spellCheck={false}
            className="field font-mono tracking-[0.18em]"
          />
        </div>
        <BouncyButton type="submit" tone="sage" loading={busy} disabled={code.trim().length < 4}>
          join
        </BouncyButton>
      </div>

      <AnimatePresence>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="mt-3 rounded-xl border border-blush-deep/40 bg-blush-light/70 px-3 py-2 text-xs text-blush-deep"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </form>
  );
}
