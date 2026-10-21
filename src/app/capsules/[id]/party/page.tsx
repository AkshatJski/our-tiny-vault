import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import dynamic from 'next/dynamic';
import { CountdownTag } from '@/components/CountdownTag';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame, Stamp } from '@/components/ui/PaperBits';
import { createServerSupabase, getSessionProfile } from '@/lib/supabase/server';
import { CONTRIBUTIONS_SELECT, PREDICTIONS_SELECT } from '@/lib/contributions-select';
import { fetchPredictionVotes } from '@/lib/votes';
import { env } from '@/lib/env';
import { formatUnlockMoment } from '@/lib/utils';
import { PRESENCE_CAP } from '@/lib/budget';
import type { CapsuleSummary, ContributionWithAuthor, PredictionWithAuthor } from '@/lib/types';
import { UnlockNotifier } from '@/components/UnlockNotifier';

const PartyLobby = dynamic(() => import('@/components/party/PartyLobby').then((m) => m.PartyLobby), {
  ssr: false,
  loading: () => (
    <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-10 sm:px-8">
      <div className="rounded-3xl border border-cream-300 bg-cream-50 p-8 shadow-paper">
        <p className="text-center font-round text-sm text-ink-soft">loading party room...</p>
      </div>
    </main>
  ),
});

export const revalidate = 0;

/**
 * The opening party room.
 *
 * Note what this page does NOT do before unlock: it never opens a realtime
 * channel. Subscribing early would be harmless in policy terms (broadcasts are
 * ephemeral and the event log only accepts presence pings), but it would still
 * consume one of the 200 free connections for a party that has not started. So
 * the waiting room is a plain server-rendered page with a countdown, and the
 * socket only comes up when there is something to be present *for*.
 */
export default async function PartyPage({ params }: { params: { id: string } }) {
  const profile = await getSessionProfile();
  if (!profile) redirect(`/login?next=/capsules/${params.id}/party`);
  if (!env.isSupabaseConfigured) notFound();

  const supabase = createServerSupabase();

  const { data: capsule } = await supabase
    .from('capsules')
    .select(
      `id, owner_id, title, subtitle, theme, cover_emoji, seal_at, unlock_at, max_members,
       member_count, storage_quota_bytes, storage_bytes, contribution_count, prediction_count, status,
       unlocked_notified_at`,
    )
    .eq('id', params.id)
    .maybeSingle<CapsuleSummary & { unlocked_notified_at: string | null }>();

  if (!capsule) notFound();

  const unlocked = new Date(capsule.unlock_at).getTime() <= Date.now();

  if (!unlocked) {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-2xl place-items-center px-5 py-16">
        <div className="relative w-full rounded-3xl border border-cream-300 bg-cream-50 p-8 text-center shadow-paper sm:p-12">
          <SketchyFrame radius={24} soft stroke="rgba(74,63,53,.2)" />
          <Stamp tone="cardboard">party not started</Stamp>

          <h1 className="mt-4 font-round text-2xl font-bold text-ink">
            {capsule.cover_emoji} {capsule.title}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-soft">
            The room is locked until the capsule opens at {formatUnlockMoment(capsule.unlock_at)}. Come
            back then — everybody pulls the string at the same time, and it is much less fun alone.
          </p>

          <div className="mt-8 flex justify-center">
            <CountdownTag unlockAt={capsule.unlock_at} />
          </div>

          <p className="mt-8 text-[11px] leading-relaxed text-ink-faint">
            Up to {Math.min(capsule.max_members, PRESENCE_CAP)} live at once. If you arrive late and the
            rope is full, you will still see everything as it happens — you just will not be holding a
            strand.
          </p>

          <Link href={`/capsules/${capsule.id}`} className="mt-6 inline-block">
            <BouncyButton tone="ghost">← back to the capsule</BouncyButton>
          </Link>
        </div>
      </main>
    );
  }

  // Unlocked: RLS will hand these over, and only now.
  const [{ data: contributionRows }, { data: predictionRows }] = await Promise.all([
    supabase
      .from('contributions')
      .select(CONTRIBUTIONS_SELECT)
      .eq('capsule_id', capsule.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('prediction_responses')
      .select(PREDICTIONS_SELECT)
      .eq('capsule_id', capsule.id)
      .order('created_at', { ascending: true }),
  ]);

  const initialPredictions = (predictionRows ?? []) as unknown as PredictionWithAuthor[];
  const initialVotes = await fetchPredictionVotes(
    supabase,
    initialPredictions.map((prediction) => prediction.id),
  );

  return (
    <>
      <div className="mx-auto w-full max-w-4xl px-5 pt-6 sm:px-6">
        <Link href={`/capsules/${capsule.id}`} className="text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          ← the capsule
        </Link>
      </div>

      <UnlockNotifier capsuleId={capsule.id} enabled={!capsule.unlocked_notified_at} />

      <PartyLobby
        capsule={capsule}
        profile={profile}
        initiallyUnlocked
        initialContributions={(contributionRows ?? []) as unknown as ContributionWithAuthor[]}
        initialPredictions={initialPredictions}
        initialVotes={initialVotes}
      />
    </>
  );
}
