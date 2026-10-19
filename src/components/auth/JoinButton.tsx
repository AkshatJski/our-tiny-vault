'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { joinCapsuleByCode } from '@/app/capsules/actions';

/** One button, one RPC, one redirect. The database decides everything else. */
export function JoinButton({ code, label = 'join this capsule' }: { code: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await joinCapsuleByCode(code);
      if (!result.ok) {
        setError(result.error ?? 'Could not join.');
        return;
      }
      router.push(`/capsules/${result.data?.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <BouncyButton tone="blush" size="lg" loading={busy} onClick={() => void join()}>
        {label}
      </BouncyButton>
      <AnimatePresence>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="max-w-xs rounded-xl border border-blush-deep/40 bg-blush-light/70 px-3 py-2 text-center text-xs text-blush-deep"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
