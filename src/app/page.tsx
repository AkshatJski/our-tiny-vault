import Link from 'next/link';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { DotDivider, SketchyFrame, Stamp, WashiTape } from '@/components/ui/PaperBits';
import { CountdownInline } from '@/components/CountdownTag';
import { getSessionProfile } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { env } from '@/lib/env';
import { formatBytes, MAX_IMAGE_BYTES, EMAIL_DAILY_CAP } from '@/lib/budget';

export const dynamic = 'force-dynamic';

/**
 * The landing page. Deliberately a *server* component with only two client
 * islands (the buttons, the countdown), so the first paint is HTML and the
 * bundle stays small on a phone.
 */
export default async function LandingPage() {
  const profile = await getSessionProfile();

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-10 sm:px-8">
      {/* ── masthead ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <span className="font-script text-3xl text-cardboard-deep">our tiny vault</span>
        <nav className="flex items-center gap-2">
          {profile ? (
            <>
              <span className="hidden text-[13px] text-ink-soft sm:inline">
                {profile.avatar_emoji} {profile.display_name}
              </span>
              <Link href="/capsules">
                <BouncyButton tone="blush" size="sm">
                  my capsules
                </BouncyButton>
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/login">
                <BouncyButton tone="ghost" size="sm">
                  sign in
                </BouncyButton>
              </Link>
              <Link href="/login">
                <BouncyButton tone="blush" size="sm">
                  start a capsule
                </BouncyButton>
              </Link>
            </>
          )}
        </nav>
      </header>

      {!env.isSupabaseConfigured ? <SetupNotice /> : null}

      {/* ── hero ─────────────────────────────────────────────────────── */}
      <section className="relative mt-14 sm:mt-20">
        <WashiTape className="left-2 top-1" rotate={-7} width={104} />

        <div className="relative rounded-3xl border border-cream-300 bg-cream-50 p-7 shadow-paper sm:p-12">
          <SketchyFrame radius={24} soft stroke="rgba(74,63,53,.2)" />

          <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <Stamp tone="butter">a time capsule for us</Stamp>

              <h1 className="mt-5 font-round text-4xl font-bold leading-[1.08] tracking-tight text-ink sm:text-5xl">
                Seal a little piece of <span className="hand-underline">now</span>
                <br />
                for the people you love.
              </h1>

              <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-ink-soft">
                Write the note, take the photo, record the voice memo. Guess where everybody will
                be in five years. Then close the lid — nobody can peek, not even you. When the day
                finally arrives, everyone opens it together, live, and scratches off the guesses.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href={profile ? '/capsules/new' : '/login'}>
                  <BouncyButton tone="blush" size="lg">
                    🕰️ make a capsule
                  </BouncyButton>
                </Link>
                <Link href={profile ? '/capsules' : '/login'}>
                  <BouncyButton tone="ghost" size="lg">
                    {profile ? 'open one you have' : 'I have an invite code'}
                  </BouncyButton>
                </Link>
              </div>

              <p className="mt-4 text-[12px] text-ink-faint">
                No password. We email you a link, and only when something actually happens.
              </p>
            </div>

            {/* a little sample capsule, hanging */}
            <div className="relative mx-auto grid place-items-center">
              <div className="hang">
                <SampleTag />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── features ─────────────────────────────────────────────────── */}
      <section className="mt-16 grid gap-5 sm:grid-cols-3">
        <Feature
          emoji="📌"
          title="Dear Future Us"
          tone="bg-butter-light"
          body="A cork pinboard of locked guesses. Everyone answers the same eight questions, and the database refuses to show a single one of them before the capsule opens."
        />
        <Feature
          emoji="🎉"
          title="the opening party"
          tone="bg-blush-light"
          body="When the clock runs out, everybody joins the same room. Drag the string together until the wax cracks, throw reactions, scratch off the predictions live."
        />
        <Feature
          emoji="🌿"
          title="built to stay free"
          tone="bg-sage-light"
          body={`Photos are compressed to ~300 KB before upload, videos are links (0 bytes), and the whole thing fits inside Vercel, Supabase and Resend free tiers — for years.`}
        />
      </section>

      <DotDivider className="my-14" />

      {/* ── the honest bit ───────────────────────────────────────────── */}
      <section className="rounded-3xl border border-cream-300 bg-cream-100 p-6 sm:p-8">
        <h2 className="font-round text-xl font-bold text-ink">the fine print, in plain words</h2>
        <ul className="mt-4 grid gap-3 text-[13px] leading-relaxed text-ink-soft sm:grid-cols-2">
          <Bullet>
            <strong className="text-ink">Sealed means sealed.</strong> Even you cannot read back
            what you put in. That is enforced by the database, not by a checkbox in the UI.
          </Bullet>
          <Bullet>
            <strong className="text-ink">Video is a link.</strong> We embed YouTube, TikTok,
            Instagram Reels and Spotify. Nothing video-shaped ever touches our storage.
          </Bullet>
          <Bullet>
            <strong className="text-ink">Photos max {formatBytes(MAX_IMAGE_BYTES)}</strong>, then
            squished to about 300 KB before they leave your phone. Voice notes stop at 60 seconds.
          </Bullet>
          <Bullet>
            <strong className="text-ink">Twenty people per party</strong>, and{' '}
            {EMAIL_DAILY_CAP} emails a day across the whole app — the free tiers, respected rather
            than gambled with.
          </Bullet>
          <Bullet>
            <strong className="text-ink">A daily heartbeat keeps it alive.</strong> Free projects
            fall asleep after a week of silence. A tiny cron job wakes ours every morning so a
            capsule sealed until 2030 still opens on time.
          </Bullet>
          <Bullet>
            <strong className="text-ink">Your invite code is the key.</strong> Anyone with the code
            can join and seal something in. Share it like a secret, because it is one.
          </Bullet>
        </ul>
      </section>

      <footer className="mt-14 text-center">
        <p className="font-script text-2xl text-cardboard-deep">see you later</p>
        <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          our tiny vault · built to outlast us
        </p>
      </footer>
    </main>
  );
}

function SampleTag() {
  const sampleUnlock = new Date(Date.now() + 1000 * 60 * 60 * 24 * 412).toISOString();
  return (
    <div className="relative">
      <div className="torn-tag grid h-44 w-44 place-items-center bg-butter px-4 text-center shadow-tag">
        <span className="font-round text-[11px] font-bold uppercase tracking-[0.22em] text-cardboard-deep/80">
          days left
        </span>
        <span className="font-round text-6xl font-bold leading-none text-cardboard-deep">412</span>
        <CountdownInline unlockAt={sampleUnlock} className="text-xs text-cardboard-deep/80" />
      </div>
      <span className="absolute -bottom-3 -right-3 rotate-[-8deg] text-3xl">📎</span>
    </div>
  );
}

function Feature({
  emoji,
  title,
  body,
  tone,
}: {
  emoji: string;
  title: string;
  body: string;
  tone: string;
}) {
  return (
    <article className={`relative overflow-hidden rounded-2xl border border-cream-300 ${tone} p-5 shadow-paper`}>
      <SketchyFrame radius={16} soft stroke="rgba(74,63,53,.16)" />
      <span className="text-2xl">{emoji}</span>
      <h2 className="mt-2 font-round text-base font-bold text-ink">{title}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{body}</p>
    </article>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden="true" className="mt-[3px] h-2 w-2 shrink-0 rotate-45 bg-blush-deep/60" />
      <span>{children}</span>
    </li>
  );
}

function SetupNotice() {
  return (
    <section className="mt-8 rounded-2xl border-2 border-dashed border-cardboard/60 bg-butter-light/70 p-5">
      <p className="font-round text-sm font-bold text-cardboard-deep">
        🧰 Almost ready — the vault needs its keys
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
        Copy <code className="rounded bg-cream-50 px-1.5 py-0.5 font-mono text-[12px]">.env.example</code> to{' '}
        <code className="rounded bg-cream-50 px-1.5 py-0.5 font-mono text-[12px]">.env.local</code>, add your
        Supabase URL + anon key, then run the four migrations in{' '}
        <code className="rounded bg-cream-50 px-1.5 py-0.5 font-mono text-[12px]">supabase/migrations</code>{' '}
        in order. Everything on this page will keep working; it just will not save anything yet.
      </p>
    </section>
  );
}
