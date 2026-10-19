import Link from 'next/link';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { JoinButton } from '@/components/auth/JoinButton';
import { CountdownInline } from '@/components/CountdownTag';
import { SketchyFrame, Stamp, WashiTape } from '@/components/ui/PaperBits';
import { createServerSupabase, getSessionProfile } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { formatUnlockDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'you are invited' };

interface Preview {
  id: string;
  title: string;
  subtitle: string | null;
  cover_emoji: string;
  unlock_at: string;
  member_count: number;
  max_members: number;
}

/**
 * "You have been invited" screen.
 *
 * It shows exactly as much as it should before you have joined: the title, the
 * date, and how full it is. That comes from `preview_invite()`, a SECURITY
 * DEFINER function that returns those seven columns and nothing else — no
 * members, no contents, no invite code echo. Being handed a link is not the same
 * as being handed the key.
 */
export default async function JoinPage({ params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code).toUpperCase();
  const profile = env.isSupabaseConfigured ? await getSessionProfile() : null;

  let preview: Preview | null = null;
  let error: string | null = null;

  if (env.isSupabaseConfigured) {
    const supabase = createServerSupabase();
    const { data, error: rpcError } = await supabase.rpc('preview_invite', { p_code: code });
    if (rpcError) {
      error = rpcError.message;
    } else {
      const rows = (Array.isArray(data) ? data : [data]) as Preview[];
      preview = rows?.[0] ?? null;
    }
  } else {
    error = 'Supabase is not configured yet.';
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl place-items-center px-5 py-16">
      <div className="relative w-full rounded-3xl border border-cream-300 bg-cream-50 p-8 text-center shadow-paper sm:p-10">
        <SketchyFrame radius={24} soft stroke="rgba(74,63,53,.2)" />
        <WashiTape className="-top-2 left-1/2 -translate-x-1/2" rotate={2} width={110} />

        <Stamp tone="butter">an invitation</Stamp>

        {error ? (
          <>
            <h1 className="mt-4 font-round text-2xl font-bold text-ink">That code did not work</h1>
            <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-soft">{error}</p>
          </>
        ) : preview ? (
          <>
            <h1 className="mt-4 font-round text-3xl font-bold leading-tight text-ink">
              <span className="mr-2">{preview.cover_emoji}</span>
              {preview.title}
            </h1>
            {preview.subtitle ? (
              <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{preview.subtitle}</p>
            ) : null}

            <div className="mt-6 inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-2xl border border-cream-300 bg-cream-100 px-4 py-3 text-[12px] text-ink-soft">
              <span>🗓️ opens {formatUnlockDate(preview.unlock_at)}</span>
              <span>
                👥 {preview.member_count}/{preview.max_members}
              </span>
              <span className="font-round font-semibold text-cardboard-deep">
                <CountdownInline unlockAt={preview.unlock_at} />
              </span>
            </div>

            <p className="mx-auto mt-5 max-w-sm text-[11px] leading-relaxed text-ink-faint">
              You will be able to seal notes, photos, voice memos and guesses into it. You will not be
              able to read anything — including your own — until the day it opens.
            </p>

            <div className="mt-7">
              {profile ? (
                <JoinButton code={code} />
              ) : (
                <Link href={`/login?next=${encodeURIComponent(`/join/${code}`)}`}>
                  <BouncyButton tone="blush" size="lg">
                    sign in to join
                  </BouncyButton>
                </Link>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 font-round text-2xl font-bold text-ink">No capsule with that code</h1>
            <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-soft">
              Codes are eight characters and case does not matter. Double-check with whoever sent it —
              they can copy it again from the capsule page.
            </p>
          </>
        )}

        <Link href="/" className="mt-8 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          ← back to the vault
        </Link>
      </div>
    </main>
  );
}
