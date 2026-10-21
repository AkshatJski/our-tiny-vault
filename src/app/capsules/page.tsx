import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame, Stamp, WashiTape } from '@/components/ui/PaperBits';
import { CountdownInline } from '@/components/CountdownTag';
import { JoinForm } from '@/components/JoinForm';
import { RefreshOnUnlock } from '@/components/RefreshOnUnlock';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { createServerSupabase, getSessionProfile } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { formatUnlockDate, seededUnit } from '@/lib/utils';
import { formatBytes, storagePercent } from '@/lib/budget';
import type { CapsuleSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'my capsules' };

const THEME_TONES: Record<string, string> = {
  cream: 'bg-cream-50',
  blush: 'bg-blush-light',
  butter: 'bg-butter-light',
  sage: 'bg-sage-light',
  cardboard: 'bg-cardboard-light',
};

/**
 * The shelf: every capsule you are part of, newest first.
 *
 * One query, joined in PostgREST rather than N+1, because the free database is
 * not the place to be casual. RLS means a member can read the capsule's own
 * metadata while it is sealed — the countdown needs the title and the date — but
 * nothing inside it.
 */
export default async function CapsulesPage() {
  if (!env.isSupabaseConfigured) {
    return <NotConfigured />;
  }

  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/capsules');

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('capsule_members')
    .select(
      `role, joined_at,
       capsules!capsule_members_capsule_id_fkey(
         id, owner_id, title, subtitle, theme, cover_emoji, seal_at, unlock_at,
         max_members, member_count, storage_quota_bytes, storage_bytes,
         contribution_count, prediction_count, status
       )`,
    )
    .eq('user_id', profile.id)
    .order('joined_at', { ascending: false });

  const rows = (data ?? []) as unknown as Array<{
    role: string;
    joined_at: string;
    capsules: CapsuleSummary | null;
  }>;

  const capsules = rows
    .map((row) => row.capsules)
    .filter((capsule): capsule is CapsuleSummary => Boolean(capsule));

  const sealed = capsules.filter((capsule) => new Date(capsule.unlock_at).getTime() > Date.now());
  const opened = capsules.filter((capsule) => new Date(capsule.unlock_at).getTime() <= Date.now());

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-10 sm:px-8">
      <RefreshOnUnlock unlockAt={capsules.map((capsule) => capsule.unlock_at)} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="font-script text-2xl text-cardboard-deep">
            our tiny vault
          </Link>
          <h1 className="mt-2 font-round text-3xl font-bold text-ink">
            hello, {profile.display_name} {profile.avatar_emoji}
          </h1>
          <p className="mt-1 text-[13px] text-ink-soft">
            {capsules.length === 0
              ? 'No capsules yet. Time to bury something.'
              : `${sealed.length} sealed · ${opened.length} open`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/capsules/new">
            <BouncyButton tone="blush">🕰️ new capsule</BouncyButton>
          </Link>
          <SignOutButton />
        </div>
      </header>

      {error ? (
        <p className="mt-6 rounded-2xl border border-blush-deep/40 bg-blush-light/70 px-4 py-3 text-[13px] text-blush-deep">
          Could not load your capsules: {error.message}
        </p>
      ) : null}

      <JoinForm />

      {opened.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sage/60 bg-sage-light/70 px-4 py-3 shadow-paper">
          <div className="flex items-center gap-2">
            <span className="text-lg">🕯️</span>
            <p className="font-round text-sm font-semibold text-cardboard-deep">
              {opened.length === 1 ? '1 vault is open' : `${opened.length} vaults are open`}
            </p>
          </div>
          <p className="text-[12px] text-ink-soft">Tap any open vault to read & celebrate</p>
        </div>
      ) : null}

      {capsules.length === 0 ? (
        <section className="mt-8 grid place-items-center rounded-3xl border-2 border-dashed border-cream-300 bg-cream-100 px-6 py-20 text-center">
          <SketchyFrame radius={22} dashed stroke="rgba(200,159,115,.5)" />
          <span className="text-4xl">🫙</span>
          <h2 className="mt-3 font-round text-lg font-bold text-ink">The shelf is bare</h2>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-soft">
            Make one, or paste an invite code above to join somebody else&apos;s. Either way, the
            first thing to write is always the hardest.
          </p>
          <Link href="/capsules/new" className="mt-5">
            <BouncyButton tone="butter">start the first one</BouncyButton>
          </Link>
        </section>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {sealed.map((capsule) => (
            <CapsuleCard key={capsule.id} capsule={capsule} />
          ))}
          {opened.map((capsule) => (
            <CapsuleCard key={capsule.id} capsule={capsule} opened />
          ))}
        </div>
      )}
    </main>
  );
}

function CapsuleCard({ capsule, opened = false }: { capsule: CapsuleSummary; opened?: boolean }) {
  const tone = THEME_TONES[capsule.theme] ?? 'bg-cream-50';
  const used = storagePercent(capsule.storage_bytes, capsule.storage_quota_bytes);
  const tilt = (seededUnit(capsule.id) * 2 - 1) * 1.4;

  return (
    <Link href={`/capsules/${capsule.id}`} className="group block">
      <article
        className={`relative overflow-hidden rounded-2xl border border-cream-300 ${tone} p-5 shadow-paper transition-transform duration-200 ease-bouncy group-hover:-translate-y-1.5`}
        style={{ transform: `rotate(${tilt}deg)` }}
      >
        <SketchyFrame radius={18} soft stroke="rgba(74,63,53,.2)" />
        {seededUnit(capsule.id + 'tape') > 0.6 ? (
          <WashiTape className="-top-2 right-6" rotate={5} width={70} />
        ) : null}

        <div className="flex items-start justify-between gap-3">
          <span className="text-3xl" aria-hidden="true">
            {capsule.cover_emoji}
          </span>
          <Stamp tone={opened ? 'sage' : 'cardboard'}>{opened ? 'open' : 'sealed'}</Stamp>
        </div>

        <h2 className="mt-3 font-round text-xl font-bold leading-snug text-ink">{capsule.title}</h2>
        {capsule.subtitle ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">
            {capsule.subtitle}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-soft">
          <span>🗓️ {opened ? 'opened' : 'opens'} {formatUnlockDate(capsule.unlock_at)}</span>
          <span>
            👥 {capsule.member_count}/{capsule.max_members}
          </span>
          <span>🫙 {capsule.contribution_count} sealed</span>
          <span>📌 {capsule.prediction_count} guesses</span>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="font-round text-[12px] font-semibold text-cardboard-deep">
            <CountdownInline unlockAt={capsule.unlock_at} />
          </span>
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-cream-200">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-cardboard/70"
              style={{ width: `${used}%` }}
            />
          </span>
          <span className="text-[11px] text-ink-faint">
            {formatBytes(capsule.storage_bytes)} / {formatBytes(capsule.storage_quota_bytes)}
          </span>
        </div>
      </article>
    </Link>
  );
}

function NotConfigured() {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl place-items-center px-5">
      <div className="rounded-2xl border-2 border-dashed border-cardboard/60 bg-butter-light/70 p-6">
        <p className="font-round text-sm font-bold text-cardboard-deep">Supabase is not configured</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          Add <code className="rounded bg-cream-50 px-1.5 py-0.5 font-mono text-[12px]">NEXT_PUBLIC_SUPABASE_URL</code>{' '}
          and <code className="rounded bg-cream-50 px-1.5 py-0.5 font-mono text-[12px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{' '}
          to <code className="rounded bg-cream-50 px-1.5 py-0.5 font-mono text-[12px]">.env.local</code>, then
          apply the migrations in <code className="rounded bg-cream-50 px-1.5 py-0.5 font-mono text-[12px]">supabase/migrations</code>.
        </p>
      </div>
    </main>
  );
}
