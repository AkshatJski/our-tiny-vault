import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CountdownTag } from '@/components/CountdownTag';
import { ContributionComposer } from '@/components/ContributionComposer';
import { PredictionPinboard } from '@/components/PredictionPinboard';
import { ScrapbookGrid } from '@/components/ScrapbookGrid';
import { InviteCodeChip } from '@/components/InviteCodeChip';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { DotDivider, SketchyFrame, Stamp } from '@/components/ui/PaperBits';
import { createServerSupabase, getSessionProfile } from '@/lib/supabase/server';
import { CONTRIBUTIONS_SELECT, PREDICTIONS_SELECT } from '@/lib/contributions-select';
import { env } from '@/lib/env';
import { formatBytes, storagePercent } from '@/lib/budget';
import { formatUnlockMoment, seededUnit } from '@/lib/utils';
import type { CapsuleSummary, ContributionWithAuthor, PredictionWithAuthor, Profile } from '@/lib/types';
import { DeleteVaultButton } from '@/components/DeleteVaultButton';
import { RefreshOnUnlock } from '@/components/RefreshOnUnlock';

export const dynamic = 'force-dynamic';

/**
 * The Capsule Hub.
 *
 * One page, two completely different lives:
 *   • SEALED  → countdown, the composer, the pinboard of locked guesses. Nothing
 *               is readable; the "vault door" shows counts, not contents.
 *   • OPEN    → the scrapbook and the pinboard, revealed.
 *
 * Whether the contents queries return anything is decided by RLS, not by an `if`
 * in this file. The `unlocked` flag below is only used to decide *which UI* to
 * show; if it were ever wrong (a clock skew, say), the database would still hand
 * back nothing. That separation is the whole design: the UI is helpful, the
 * policy is authoritative.
 */
export default async function CapsuleHubPage({ params }: { params: { id: string } }) {
  const profile = await getSessionProfile();
  if (!profile) redirect(`/login?next=/capsules/${params.id}`);

  if (!env.isSupabaseConfigured) notFound();

  const supabase = createServerSupabase();

  const { data: capsule } = await supabase
    .from('capsules')
    .select(
      `id, owner_id, title, subtitle, theme, cover_emoji, invite_code, seal_at, unlock_at,
       max_members, member_count, storage_quota_bytes, storage_bytes, contribution_count,
       prediction_count, status`,
    )
    .eq('id', params.id)
    .maybeSingle<CapsuleSummary & { invite_code: string }>();

  // A non-member gets the same 404 as a wrong id. Capsule membership is not
  // something to confirm or deny to a stranger.
  if (!capsule) notFound();

  const { data: memberRows } = await supabase
    .from('capsule_members')
    .select(
      'user_id, role, joined_at, profiles!capsule_members_user_id_fkey(id, handle, display_name, avatar_emoji, accent_color)',
    )
    .eq('capsule_id', capsule.id)
    .order('joined_at', { ascending: true });

  const members = (memberRows ?? []) as unknown as Array<{
    user_id: string;
    role: string;
    joined_at: string;
    profiles: Pick<Profile, 'id' | 'handle' | 'display_name' | 'avatar_emoji' | 'accent_color'> | null;
  }>;

  const unlocked = new Date(capsule.unlock_at).getTime() <= Date.now();
  const isOwner = capsule.owner_id === profile.id;
  const usedPercent = storagePercent(capsule.storage_bytes, capsule.storage_quota_bytes);

  // Before unlock these two promises resolve to empty arrays. They are not
  // "skipped" — they are actually run, and the policy actually refuses. That is
  // the behaviour we want to be able to point at.
  const [{ data: contributionRows }, { data: predictionRows }] = unlocked
    ? await Promise.all([
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
      ])
    : [{ data: [] }, { data: [] }];

  const contributions = (contributionRows ?? []) as unknown as ContributionWithAuthor[];
  const predictions = (predictionRows ?? []) as unknown as PredictionWithAuthor[];

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-8 sm:px-8">
      <Link href="/capsules" className="text-[12px] uppercase tracking-[0.16em] text-ink-faint">
        ← the shelf
      </Link>

      {/* When the clock runs out while this tab is open, ask the server again. */}
      {unlocked ? null : <RefreshOnUnlock unlockAt={capsule.unlock_at} />}

      {/* ── the front of the box ─────────────────────────────────────────── */}
      <header className="relative mt-4 rounded-3xl border border-cream-300 bg-cream-50 p-6 shadow-paper sm:p-9">
        <SketchyFrame radius={24} soft stroke="rgba(74,63,53,.2)" />

        <div className="grid gap-8 lg:grid-cols-[1.3fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Stamp tone={unlocked ? 'sage' : 'cardboard'}>{unlocked ? 'open' : 'sealed'}</Stamp>
              {isOwner ? <Stamp tone="butter">yours</Stamp> : null}
              <Stamp tone="ink">{capsule.member_count} of {capsule.max_members} in</Stamp>
            </div>

            <h1 className="mt-4 font-round text-3xl font-bold leading-tight text-ink sm:text-4xl">
              <span className="mr-2">{capsule.cover_emoji}</span>
              {capsule.title}
            </h1>

            {capsule.subtitle ? (
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-soft">{capsule.subtitle}</p>
            ) : null}

            <p className="mt-4 text-[13px] text-ink-soft">
              {unlocked ? 'Opened' : 'Opens'} {formatUnlockMoment(capsule.unlock_at)}
              <span className="text-ink-faint">
                {unlocked
                  ? ' · the seal is broken, the scrapbook is below'
                  : ` · sealed ${formatUnlockMoment(capsule.seal_at)}`}
              </span>
            </p>

            <div className="mt-5">
              <InviteCodeChip
                code={capsule.invite_code}
                partyUrl={`${env.siteUrl}/capsules/${capsule.id}/party`}
              />
            </div>

            {/* member shelf */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {members.map((member) => (
                <span
                  key={member.user_id}
                  className="inline-flex items-center gap-2 rounded-full border border-cream-300 bg-cream-100 px-3 py-1.5"
                  title={`${member.profiles?.display_name ?? 'someone'} (${member.role})`}
                >
                  <span
                    className="grid h-6 w-6 place-items-center rounded-full text-[12px]"
                    style={{ background: member.profiles?.accent_color ?? '#F4C7C3' }}
                    aria-hidden="true"
                  >
                    {member.profiles?.avatar_emoji ?? '🫧'}
                  </span>
                  <span className="font-round text-[12px] font-semibold text-ink-soft">
                    {member.profiles?.display_name ?? 'someone'}
                  </span>
                  {member.role === 'owner' ? <span className="text-[10px] text-cardboard-deep">host</span> : null}
                </span>
              ))}
            </div>

            {/* storage honesty */}
            <div className="mt-5 flex items-center gap-3">
              <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">vault space</span>
              <span className="relative h-2 w-40 overflow-hidden rounded-full bg-cream-200">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${usedPercent}%`,
                    background: usedPercent > 85 ? '#D98C86' : '#B9CDB4',
                  }}
                />
              </span>
              <span className="text-[11px] text-ink-faint">
                {formatBytes(capsule.storage_bytes)} / {formatBytes(capsule.storage_quota_bytes)}
              </span>
            </div>
          </div>

          <div className="justify-self-center lg:justify-self-end">
            {unlocked ? (
              <div className="text-center">
                <div className="torn-tag grid h-40 w-40 place-items-center bg-butter shadow-tag">
                  <span className="text-3xl">🕯️</span>
                  <span className="font-round text-sm font-bold uppercase tracking-[0.14em] text-cardboard-deep">
                    it&apos;s open
                  </span>
                </div>
                <Link href={`/capsules/${capsule.id}/party`} className="mt-4 inline-block">
                  <BouncyButton tone="blush">🎉 open the party room</BouncyButton>
                </Link>
                {isOwner ? (
                  <div>
                    <DeleteVaultButton capsuleId={capsule.id} />
                    <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-ink-faint">only after opening · irreversible</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <CountdownTag unlockAt={capsule.unlock_at} />
            )}
          </div>
        </div>
      </header>

      {/* ── contents ─────────────────────────────────────────────────────── */}
      {unlocked ? (
        <>
          <DotDivider className="my-10" />
          <section className="space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-script text-3xl leading-none text-cardboard-deep">the scrapbook</h2>
                <p className="mt-1 text-[13px] text-ink-soft">
                  {contributions.length} thing{contributions.length === 1 ? '' : 's'} sealed in, in order.
                </p>
              </div>
              <Link href={`/capsules/${capsule.id}/party`}>
                <BouncyButton tone="ghost" size="sm">
                  relive it in the party room →
                </BouncyButton>
              </Link>
            </header>
            <ScrapbookGrid contributions={contributions} />
          </section>

          <DotDivider className="my-10" />

          <PredictionPinboard
            capsuleId={capsule.id}
            profile={profile}
            unlocked
            sealedCount={predictions.length}
            predictions={predictions}
          />
        </>
      ) : (
        <>
          <DotDivider className="my-10" />

          <section className="space-y-4">
            <header>
              <h2 className="font-round text-xl font-bold text-ink">behind the door</h2>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
                {capsule.contribution_count} contribution{capsule.contribution_count === 1 ? '' : 's'} and{' '}
                {capsule.prediction_count} guess{capsule.prediction_count === 1 ? '' : 'es'} are already
                inside. What they say is not available to anyone yet — not you, not the host. The count
                is metadata; the contents are behind the policy.
              </p>
            </header>
            <SealedDoor count={capsule.contribution_count} />
          </section>

          <DotDivider className="my-10" />

          <section className="grid gap-6 lg:grid-cols-2">
            <ContributionComposer capsuleId={capsule.id} profile={profile} />
            <div className="space-y-4">
              <PredictionPinboard
                capsuleId={capsule.id}
                profile={profile}
                unlocked={false}
                sealedCount={capsule.prediction_count}
                predictions={[]}
              />
            </div>
          </section>

          <DotDivider className="my-10" />

          <section className="rounded-3xl border border-cream-300 bg-cream-100 p-6">
            <h2 className="font-round text-lg font-bold text-ink">what happens on the day</h2>
            <ol className="mt-4 grid gap-3 text-[13px] leading-relaxed text-ink-soft sm:grid-cols-2">
              <Step n={1}>
                The daily job wakes up at 00:00 UTC and notices {formatUnlockMoment(capsule.unlock_at)} has
                arrived. It queues one email per member — capped at ninety a day across the whole app,
                so nobody gets two hundred emails at once.
              </Step>
              <Step n={2}>
                Someone opens the party room. Everybody piles in and grabs a strand of the twine. The
                room holds twenty live at a time; after that you watch along.
              </Step>
              <Step n={3}>
                You pull together until the wax cracks — then the scrapbook and the prediction board
                appear, all at once, for everybody.
              </Step>
              <Step n={4}>
                The guesses get scratched off one by one. Somebody is right, somebody is dramatically
                wrong, and the whole thing was worth the five years.
              </Step>
            </ol>
          </section>
        </>
      )}
    </main>
  );
}

/** The vault door: counts and shapes only, no contents. */
function SealedDoor({ count }: { count: number }) {
  const shown = Math.min(Math.max(count, 6), 18);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: shown }).map((_, index) => {
        const rotate = (seededUnit(`door-${index}`) * 2 - 1) * 2;
        return (
          <div
            key={index}
            className="relative min-h-[104px] overflow-hidden rounded-xl border border-cream-300 bg-cream-50 p-4 shadow-paper"
            style={{ transform: `rotate(${rotate}deg)` }}
          >
            <div className="space-y-2.5 blur-[3.5px]" aria-hidden="true">
              <div className="h-2.5 w-2/3 rounded-full bg-ink/20" />
              <div className="h-2.5 w-full rounded-full bg-ink/15" />
              <div className="h-2.5 w-3/4 rounded-full bg-ink/15" />
            </div>
            <span className="absolute bottom-2 right-3 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              sealed
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-butter font-round text-[12px] font-bold text-cardboard-deep">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}
