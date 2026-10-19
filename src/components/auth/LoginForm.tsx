'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame, Stamp, WashiTape } from '@/components/ui/PaperBits';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { env } from '@/lib/env';
import { friendlyError } from '@/lib/utils';

/**
 * Passwordless sign-in.
 *
 * Supabase's built-in email sender is limited on the free plan (a handful per
 * hour), which is fine for a capsule shared between friends and costs us nothing.
 * You can point Supabase's SMTP at Resend later if you want the nicer template —
 * see decision.md — but be aware those auth emails share the same 100/day budget
 * as our unlock notifications.
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/capsules';
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('sending');
    setMessage(null);
    try {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${env.siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
          // No duplicate accounts: one human, one profile, one avatar emoji.
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      setState('sent');
    } catch (err) {
      setState('error');
      setMessage(friendlyError(err));
    }
  };

  return (
    <div className="relative w-full max-w-md rounded-3xl border border-cream-300 bg-cream-50 p-7 shadow-paper sm:p-9">
      <SketchyFrame radius={22} soft stroke="rgba(74,63,53,.22)" />
      <WashiTape className="-top-2 left-8" rotate={-4} width={86} />

      <Link href="/" className="font-script text-2xl text-cardboard-deep">
        our tiny vault
      </Link>

      <h1 className="mt-4 font-round text-2xl font-bold text-ink">come in</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
        Type your email and we will send a single-use link. No password to forget in five years,
        which — for an app about five years — feels important.
      </p>

      {state === 'sent' ? (
        <motion.div
          initial={{ opacity: 0, y: 8, rotate: -1 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          className="mt-6 rounded-2xl border border-sage-deep/40 bg-sage-light/70 p-4"
        >
          <Stamp tone="sage">link sent</Stamp>
          <p className="mt-2 text-[13px] leading-relaxed text-ink">
            Check <strong className="text-ink">{email}</strong>. The link signs you in and lands you
            back where you were trying to go.
          </p>
          <p className="mt-2 text-[11px] text-ink-faint">
            Nothing? Look in spam, or wait a minute — free-tier email senders are not known for their
            speed.
          </p>
          <button
            type="button"
            onClick={() => setState('idle')}
            className="mt-3 text-[12px] font-bold uppercase tracking-[0.12em] text-cardboard-deep underline decoration-dotted"
          >
            use a different email
          </button>
        </motion.div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="field-label">
              your email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@somewhere.com"
              className="field"
            />
          </div>

          <BouncyButton
            type="submit"
            tone="blush"
            size="lg"
            className="w-full"
            loading={state === 'sending'}
            disabled={!email.includes('@')}
          >
            send me the link
          </BouncyButton>
        </form>
      )}

      <AnimatePresence>
        {message ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="mt-4 rounded-xl border border-blush-deep/40 bg-blush-light/70 px-3 py-2 text-xs leading-relaxed text-blush-deep"
          >
            {message}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <p className="mt-6 text-[11px] leading-relaxed text-ink-faint">
        We store your email so the daily job can tell you when a capsule opens. One email per
        capsule, ever. It never leaves the vault otherwise.
      </p>
    </div>
  );
}
