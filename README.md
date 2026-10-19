# our tiny vault 🫙

A collaborative online **time capsule**. A few friends seal notes, photos, voice
memos and links into a shared vault. Nobody — not the author, not the owner, not
the person who built it — can read any of it until the day it opens. Then
everyone gets a notification and gathers in a live **unwrapping party**, pulling a
virtual string together until the wax seal cracks.

It looks like a scrapbook: cream paper, washi tape, torn strips, hand-drawn
borders, bouncy springs. It runs entirely on **free tiers**, on purpose — the
interesting constraint is that it must still work in three years when the capsule
opens.

---

## What it does

| Surface | What happens |
| --- | --- |
| `/` | Landing page. Cozy, explains the promise. |
| `/login` | Passwordless magic-link sign-in (Supabase Auth). |
| `/capsules` | **The shelf** — the capsules you belong to, sealed and open. |
| `/capsules/new` | **Make a capsule** — title, cover emoji, theme, member cap, unlock date. |
| `/capsules/[id]` | **The hub** — torn-paper countdown, the sealed composer, the "Dear Future Us" prediction pinboard. |
| `/capsules/[id]/party` | **The opening party** — live, synchronous, cooperative unwrap + floating emoji reactions. |
| `/join/[code]` | **Invite landing** — join by 8-character code. |
| `/api/cron/check-unlocks` | The one daily cron: keep-alive, unlock, email dispatch, pruning. |
| `/api/health` | Cheap keep-alive + an honest status readout. |

Two things make it more than a folder of files:

1. **The rule.** Nothing sealed is readable before unlock, including by its own
   author. This is enforced by Postgres row-level security that compares
   `capsules.unlock_at` to `now()` — *not* by an `if` in the UI.
2. **The party.** Unwrapping is cooperative. Everyone present drags their own
   strand of twine; the wax cracks when the *combined* pull covers 82% of the
   rope. Four people means ~20% each. Alone at 2am, one person can pull the whole
   thing — and should be able to.

---

## The $0 budget, in one table

Every number below is restated as a product rule in `src/lib/budget.ts` so a
future change ("just bump images to 20 MB") fails in code review instead of
quietly at the end of the month.

| Free tier | Limit | How we spend it |
| --- | --- | --- |
| Supabase Storage | 1 GB | Platform ceiling **900 MB** (DB trigger). Per capsule quota **60 MB**. |
| Supabase Database | 500 MB | Party log pruned after **7 days**; email queue rows are tiny. |
| Supabase Realtime | 200 concurrent | **20 presence slots per capsule** → ~10 simultaneous parties. |
| Supabase Auth | 50k MAU | Magic links only. |
| Resend | 100 emails/day | Self-capped at **90/day**; overflow is *deferred*, never dropped. |
| Vercel Hobby | 1 cron/day, 60s max | Exactly one cron, `0 0 * * *` UTC, `maxDuration: 60`. |
| Vercel request body | ~4.5 MB | Uploads go **browser → Supabase Storage directly**; never through a function. |

Media rules that fall out of the budget:

- **Images** — max **5 MB** before upload, then compressed **in the browser**
  (longest edge 1600px, target 300 KB). The 5 MB pre-check exists because a 5 MB
  photo would otherwise be rejected by Vercel's 4.5 MB body cap before our code
  ran.
- **Audio** — max **60 seconds**, recorded at ~32 kbps mono.
- **Video** — *no file uploads, ever*. The video type accepts a link only
  (YouTube, TikTok, Instagram Reels, Spotify) and stores the canonical URL. A
  video link costs the vault 0 MB.

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

The app **builds and boots without any keys** — it renders a friendly
"not configured yet" notice instead of crashing. That is deliberate.

### 2. Create a free Supabase project

<https://supabase.com> → New project (free). Then, from **Project Settings → API**,
copy into `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only — the cron uses this to bypass RLS)

### 3. Apply the migrations, **in order**

Open the Supabase **SQL Editor** and run these files one at a time, in this exact
order. They are numbered because they build on each other.

| File | What it creates |
| --- | --- |
| `supabase/migrations/0001_schema.sql` | Tables, enums, indexes, CHECK-constraint budget/format guards. |
| `supabase/migrations/0002_rls.sql` | The whole no-read-before-unlock rule, the `SECURITY DEFINER` helper functions, and the column-level grants. |
| `supabase/migrations/0003_functions_triggers.sql` | Counters, budget guards, `join_capsule_by_code`, `claim_presence_slot`, the cron internals. |
| `supabase/migrations/0004_storage.sql` | The private `capsule-media` bucket, its path-based policies, `capsule-backups`, and the `storage_overview` view. |

> If you prefer the CLI: `supabase db push` applies them in filename order for you.

After 0001 runs, a trigger on `auth.users` creates a `profiles` row the first time
anyone signs in, so there is nothing to seed by hand.

### 4. Configure magic-link auth

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` for dev, then your production URL.
- **Redirect URLs**: add `http://localhost:3000/auth/callback` and
  `https://<your-app>.vercel.app/auth/callback`.

The callback route accepts both shapes Supabase sends — `?code=` (PKCE) and
`?token_hash=&type=` (OTP) — so you do not have to pick a flow.

### 5. (Optional) Email notifications with Resend

<https://resend.com> → API key → verify a domain (or use `onboarding@resend.dev`
to test). Then in `.env.local`:

```
RESEND_API_KEY=re_...
RESEND_FROM="our tiny vault <hello@your-verified-domain.com>"
```

**With no Resend key, nothing is lost**: unlock notifications stay `pending` in
`notification_queue` and the cron tells you so, loudly, in its report.

### 6. Run it

```bash
npm run dev            # http://localhost:3000
npm run typecheck      # tsc --noEmit
npm run build          # production build
npm run cron:local     # poke the cron by hand (dev only, no secret needed)
npm run keepalive:local
```

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public anon key. Safe in the browser; RLS is the gate. |
| `SUPABASE_SERVICE_ROLE_KEY` | for cron | Server-only. Used **only** by the daily cron and the keep-alive. |
| `RESEND_API_KEY` | no | Unlock emails. Missing → notifications are deferred, not lost. |
| `RESEND_FROM` | no | Verified sender. Defaults to `onboarding@resend.dev`. |
| `RESEND_DAILY_CAP` | no | Clamped to ≤ 90 in code. The failsafe against Resend's 100/day. |
| `CRON_SECRET` | prod | Vercel sends `Authorization: Bearer $CRON_SECRET` to cron routes. |
| `NEXT_PUBLIC_SITE_URL` | prod | Used to build party links inside unlock emails. |
| `ENABLE_KEEPALIVE` | no | Default `true`. Daily DB touch so the free project never auto-pauses. |
| `ENABLE_WEEKLY_BACKUP` | no | Default `false`. Weekly **metadata-only** snapshot to `capsule-backups`. |
| `CRON_MAX_CAPSULES_PER_RUN` | no | Default 25. Cheap query guard. |

Generate a cron secret with:

```bash
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

---

## Deploying to Vercel (free, forever)

1. Push this repo to GitHub, then **Import** it in Vercel. Framework is
   auto-detected (Next.js).
2. Add every variable from the table above in **Project → Settings → Environment
   Variables**. Set `NEXT_PUBLIC_SITE_URL` to your `.vercel.app` domain.
3. Deploy. `vercel.json` already declares the cron (one run per day at 00:00 UTC)
   and `maxDuration: 60` for the cron function.
4. Add your production `/auth/callback` URL to Supabase's Redirect URLs.

### Why the cron matters more than it looks

Supabase **pauses free projects after 7 days without API activity.** A capsule
sealed until 2028 would be an empty database long before it opened. The single
daily cron request is the heartbeat that keeps the project awake, and every beat
is logged in `system_heartbeats` so you can see the history.

Belt-and-braces: point any free uptime pinger (cron-job.org, UptimeRobot) at
`https://<your-app>.vercel.app/api/health` once a day. That URL runs one trivial
query and returns an honest status readout including what is *not* configured.

---

## Project layout

```
src/
  app/
    page.tsx                     landing
    login/                       magic-link sign-in
    auth/callback/route.ts       handles ?code= and ?token_hash=
    capsules/
      page.tsx                   the shelf
      new/page.tsx               make a capsule
      actions.ts                 server actions: create / join / update profile
      [id]/page.tsx              the hub (sealed view vs open view)
      [id]/party/page.tsx        the party room
    join/[code]/page.tsx         invite landing
    api/
      cron/check-unlocks/        the one daily cron
      realtime/                  presence ticket + keep-alive ping
      health/                    keep-alive + status
      contributions/             server-side door to the same rules
  components/
    ui/                          PaperBits, PaperCard, BouncyButton
    CountdownTag.tsx             torn-paper countdown
    ScrapbookGrid.tsx            the revealed scrapbook
    PredictionPinboard.tsx       "Dear Future Us" cork board + sealed slips
    ContributionComposer.tsx     ties every contribution kind to one seal action
    upload/                      ImageUploader, AudioRecorder, VideoLinkField
    party/                       PartyLobby, UnwrapString, ReactionTray, ScratchOffResolution
    auth/                        LoginForm, JoinButton
  lib/
    budget.ts                    every free-tier number, in one place
    compression.ts               client-side image shrink (dynamically imported)
    contributions.ts             the only place contributions/guesses are written
    realtime.ts                  channel name, broadcast events, combinedPull()
    prompts.ts                   prediction prompt pack + localStorage guess ledger
    video-link.ts                URL → canonical provider/embed id
    sound.ts                     WebAudio paper crinkle/pop/tear/chime
    utils.ts                     countdown parts, seeded rotation, friendlyError
    env.ts                       the only reader of process.env
    supabase/                    browser / server / admin / middleware clients
supabase/migrations/             0001 → 0004, apply in order
```

---

## Troubleshooting

**"Supabase is not configured yet."**
`.env.local` is missing the two public keys, or you did not restart `next dev`.

**Sign-in link goes nowhere.**
The `/auth/callback` URL is not in Supabase's Redirect URLs, or `NEXT_PUBLIC_SITE_URL`
does not match where you are running.

**`42501` / "That door is locked right now."**
This is usually *correct behaviour*: you tried to read something before unlock.
Sealed inserts are made with `Prefer: return=minimal` precisely so the database
never has to hand the row back. If you see this after unlock, the RLS helpers in
`0002_rls.sql` may not have been applied.

**A photo is rejected before uploading.**
Over 5 MB. Take a screenshot, or use a smaller version. For video, use the **Video
Link** type — file uploads are intentionally not supported.

**No unlock emails arrived.**
Check `/api/health` for `configured.email`. With no key, notifications are marked
`pending` and retried by tomorrow's cron, not dropped. Check `notification_queue`
and `cron_runs` for the record.

**The 21st person in the party cannot pull the string.**
Working as designed — see the presence cap above. They still see everything live;
they are just not holding a strand.
