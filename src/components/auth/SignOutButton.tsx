'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { signOut } from '@/app/auth/actions';

/**
 * "log out" — clears the server-side session cookie, then sends you home.
 *
 * `router.replace` (not push) so the back button cannot walk you into a page
 * that was rendered while you were still signed in. `refresh()` afterwards
 * forces the new, signed-out tree to be fetched instead of reusing the cache.
 */
export function SignOutButton({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onSignOut = async () => {
    setBusy(true);
    const result = await signOut();
    if (!result.ok) {
      setBusy(false);
      alert(result.error ?? 'Could not sign you out. Try again.');
      return;
    }
    router.replace('/');
    router.refresh();
  };

  return (
    <BouncyButton
      tone="ghost"
      size={size}
      loading={busy}
      onClick={() => void onSignOut()}
      className={className}
    >
      {busy ? 'signing out…' : 'log out'}
    </BouncyButton>
  );
}
