'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame, Stamp, WashiTape } from '@/components/ui/PaperBits';
import { createCapsule } from '@/app/capsules/actions';
import { cn, formatUnlockDate } from '@/lib/utils';
import { CAPSULE_QUOTA_BYTES, formatBytes } from '@/lib/budget';

const EMOJI_CHOICES = ['🕰️', '🫙', '🌿', '🍰', '🧸', '📼', '🪄', '🌙', '🧵', '🎞️', '🪴', '✉️'];

const THEMES = [
  { id: 'cream', label: 'cream', swatch: 'bg-cream-100' },
  { id: 'blush', label: 'blush', swatch: 'bg-blush' },
  { id: 'butter', label: 'butter', swatch: 'bg-butter' },
  { id: 'sage', label: 'sage', swatch: 'bg-sage' },
  { id: 'cardboard', label: 'cardboard', swatch: 'bg-cardboard-light' },
] as const;

const PRESETS = [
  { label: '5 minutes', minutes: 5 },
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '1 week', days: 7 },
  { label: '1 year', years: 1 },
  { label: '3 years', years: 3 },
  { label: '5 years', years: 5 },
  { label: '10 years', years: 10 },
];

/**
 * Making a capsule: the only screen where the future is a number field.
 *
 * The unlock time is normalised to 12:00 UTC by the server action. That is not
 * fussiness — the daily cron decides "what opens today" using UTC dates, so a
 * capsule set to 23:40 local time would land on the wrong day for somebody. Noon
 * UTC is safely "today" for every timezone the sun touches.
 */
export function NewCapsuleForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [emoji, setEmoji] = useState('🕰️');
  const [theme, setTheme] = useState<(typeof THEMES)[number]['id']>('butter');
  const [maxMembers, setMaxMembers] = useState(12);
  const [years, setYears] = useState(5);
  const [customDate, setCustomDate] = useState('');
  const [offsetMinutes, setOffsetMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlockPreview = useMemo(() => {
    if (offsetMinutes !== null) return new Date(Date.now() + offsetMinutes * 60_000);
    if (customDate) return new Date(`${customDate}T12:00:00Z`);
    const date = new Date();
    date.setFullYear(date.getFullYear() + years);
    return date;
  }, [customDate, years, offsetMinutes]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.set('title', title);
    formData.set('subtitle', subtitle);
    formData.set('cover_emoji', emoji);
    formData.set('theme', theme);
    formData.set('max_members', String(maxMembers));
    formData.set('unlock_at', unlockPreview.toISOString());

    try {
      const result = await createCapsule(formData);
      if (!result.ok || !result.data) {
        setError(result.error ?? 'Could not make that capsule.');
        return;
      }
      router.push(`/capsules/${result.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make that capsule.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* ── the basics ────────────────────────────────────────────────── */}
      <section className="relative rounded-3xl border border-cream-300 bg-cream-50 p-6 shadow-paper sm:p-8">
        <SketchyFrame radius={22} soft stroke="rgba(74,63,53,.2)" />
        <WashiTape className="-top-2 left-10" rotate={-5} width={92} />

        <h2 className="font-round text-xl font-bold text-ink">what are we burying?</h2>

        <div className="mt-5 space-y-5">
          <div>
            <label htmlFor="title" className="field-label">
              a title
            </label>
            <input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value.slice(0, 120))}
              placeholder="For when we are old and boring"
              className="field"
              required
            />
          </div>

          <div>
            <label htmlFor="subtitle" className="field-label">
              a subtitle (optional)
            </label>
            <input
              id="subtitle"
              value={subtitle}
              onChange={(event) => setSubtitle(event.target.value.slice(0, 200))}
              placeholder="Notes, photos and terrible predictions from the flat with the bad radiator"
              className="field"
            />
          </div>

          <div>
            <span className="field-label">a sticker for the cover</span>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setEmoji(choice)}
                  aria-pressed={emoji === choice}
                  className={cn(
                    'grid h-11 w-11 place-items-center rounded-xl border text-xl transition-transform',
                    emoji === choice
                      ? 'border-cardboard/70 bg-butter-light scale-110'
                      : 'border-cream-300 bg-cream-100 hover:scale-105',
                  )}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="field-label">paper colour</span>
            <div className="flex flex-wrap gap-2">
              {THEMES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTheme(option.id)}
                  aria-pressed={theme === option.id}
                  className={cn(
                    'flex items-center gap-2 rounded-full border px-3 py-1.5 font-round text-[12px] font-semibold',
                    theme === option.id ? 'border-cardboard/70 bg-cream-200' : 'border-cream-300 bg-cream-100',
                  )}
                >
                  <span className={cn('h-4 w-4 rounded-full border border-ink/15', option.swatch)} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── the promise ───────────────────────────────────────────────── */}
      <section className="relative rounded-3xl border border-cream-300 bg-butter-light/70 p-6 shadow-paper sm:p-8">
        <SketchyFrame radius={22} soft stroke="rgba(140,98,57,.25)" />

        <h2 className="font-round text-xl font-bold text-cardboard-deep">when does it open?</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Long unlocks keep it safe; short ones are fine for testing. The date can only ever be moved <em>later</em>, never earlier.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setOffsetMinutes(null);
                setCustomDate('');
                if (preset.years) setYears(preset.years);
                if (preset.minutes) setOffsetMinutes(preset.minutes);
                if (preset.hours) setOffsetMinutes(preset.hours * 60);
                if (preset.days) setOffsetMinutes(preset.days * 24 * 60);
              }}
              aria-pressed={
                (offsetMinutes !== null &&
                  ((preset.minutes && offsetMinutes === preset.minutes) ||
                    (preset.hours && offsetMinutes === preset.hours * 60) ||
                    (preset.days && offsetMinutes === preset.days * 24 * 60))) ||
                (offsetMinutes === null &&
                  !customDate &&
                  !!preset.years &&
                  years === preset.years)
              }
              className={cn(
                'rounded-full border px-4 py-2 font-round text-[13px] font-semibold',
                (offsetMinutes !== null && ((preset.minutes && offsetMinutes === preset.minutes) || (preset.hours && offsetMinutes === preset.hours * 60) || (preset.days && offsetMinutes === preset.days * 24 * 60))) ||
                  (!customDate && offsetMinutes === null && preset.years && years === preset.years)
                  ? 'border-cardboard/70 bg-cream-50 shadow-paper'
                  : 'border-cardboard/30 bg-cream-100/70 hover:bg-cream-50',
              )}
            >
              {preset.years ? '+' : ''}{preset.label}
            </button>
          ))}
        </div>

        <div className="mt-4 max-w-xs">
          <label htmlFor="custom-date" className="field-label">
            or pick the day
          </label>
          <input
            id="custom-date"
            type="date"
            value={customDate}
            min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
            onChange={(event) => {
              setOffsetMinutes(null);
              setCustomDate(event.target.value);
            }}
            className="field"
          />
        </div>

        <motion.div
          key={unlockPreview.toISOString()}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 inline-flex items-center gap-3 rounded-2xl border border-cardboard/40 bg-cream-50 px-4 py-3"
        >
          <span className="text-2xl">🗓️</span>
          <span>
            <span className="block text-[11px] uppercase tracking-[0.16em] text-ink-faint">
              {offsetMinutes !== null ? 'opens in' : 'opens at 12:00 UTC on'}
            </span>
            <span className="font-round text-base font-bold text-ink">
              {Number.isNaN(unlockPreview.getTime())
                ? '—'
                : offsetMinutes !== null
                  ? `${offsetMinutes >= 60 ? `${Math.floor(offsetMinutes / 60)}h` : ''} ${offsetMinutes % 60 ? `${offsetMinutes % 60}m` : ''}`.trim() || `${offsetMinutes}m`
                  : formatUnlockDate(unlockPreview.toISOString())}
            </span>
          </span>
          <Stamp tone="butter">
            {Number.isNaN(unlockPreview.getTime())
              ? '—'
              : offsetMinutes !== null
                ? 'soon'
                : `${Math.max(1, Math.round((unlockPreview.getTime() - Date.now()) / (365.25 * 86400_000)))}y`}
          </Stamp>
        </motion.div>
      </section>

      {/* ── the guest list ────────────────────────────────────────────── */}
      <section className="relative rounded-3xl border border-cream-300 bg-cream-50 p-6 shadow-paper sm:p-8">
        <SketchyFrame radius={22} soft stroke="rgba(74,63,53,.2)" />

        <h2 className="font-round text-xl font-bold text-ink">who is coming?</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Up to twenty people, and that ceiling is a free-tier decision rather than a social one:
          each person can hold one live connection during the opening party, and the shared free
          allowance is 200. Twenty keeps ten separate parties possible.
        </p>

        <div className="mt-5 flex items-center gap-4">
          <input
            id="max-members"
            type="range"
            min={2}
            max={20}
            value={maxMembers}
            onChange={(event) => setMaxMembers(Number(event.target.value))}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-cream-200 accent-cardboard"
          />
          <span className="w-24 shrink-0 text-right font-round text-sm font-bold text-cardboard-deep">
            {maxMembers} {maxMembers === 1 ? 'person' : 'people'}
          </span>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
          Each capsule gets {formatBytes(CAPSULE_QUOTA_BYTES)} of storage. At ~300 KB a photo that is
          roughly {Math.floor(CAPSULE_QUOTA_BYTES / (300 * 1024))} compressed photos — and video
          links are free.
        </p>
      </section>

      <AnimatePresence>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="rounded-2xl border border-blush-deep/40 bg-blush-light/70 px-4 py-3 text-[13px] text-blush-deep"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-sm text-[12px] leading-relaxed text-ink-faint">
          You will get an invite code to share. Anyone with the code can seal something in — nobody
          can read anything until the day arrives.
        </p>
        <BouncyButton type="submit" tone="blush" size="lg" loading={busy} disabled={title.trim().length === 0}>
          🕰️ seal the box
        </BouncyButton>
      </div>
    </form>
  );
}
