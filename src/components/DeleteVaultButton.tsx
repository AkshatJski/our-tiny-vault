'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { deleteCapsule } from '@/app/capsules/actions';

export function DeleteVaultButton({ capsuleId }: { capsuleId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    if (!confirm('Delete this vault forever? This cannot be undone.')) return;
    setBusy(true);
    const r = await deleteCapsule(capsuleId);
    setBusy(false);
    if (r.ok) {
      router.push('/capsules');
      return;
    }
    alert(r.error || 'Could not delete this vault.');
  };

  return (
    <BouncyButton tone="blush" size="sm" loading={busy} onClick={onDelete} className="mt-4">
      🗑️ delete this vault
    </BouncyButton>
  );
}
