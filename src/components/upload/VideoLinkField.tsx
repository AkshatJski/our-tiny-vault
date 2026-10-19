'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { parseExternalLink, type ParsedExternalLink } from '@/lib/video-link';
import { cn } from '@/lib/utils';

/**
 * The video field. It is a URL input and nothing else — no file picker, no
 * drag-and-drop, no `accept="video/*"`. There is no code path in this app that
 * can put a video into our storage bucket, which is the only reliable way to
 * keep that promise after three people have "helpfully" added a feature.
 *
 * The user's string is parsed, and only a *reconstructed* embed URL (built from a
 * validated id) is ever rendered into an iframe. Arbitrary URLs cannot become
 * iframes, so the classic `javascript:` / `data:` injection routes are closed.
 */
export function VideoLinkField({
  value,
  onChange,
  provider,
  onProvider,
  helpText,
  placeholder = 'https://youtube.com/watch?v=…',
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  provider: ParsedExternalLink['provider'] | null;
  onProvider: (next: ParsedExternalLink['provider'] | null) => void;
  helpText: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const parsed = useMemo(() => (value.trim() ? parseExternalLink(value) : null), [value]);

  // Keep the parent's provider in sync without an effect loop: derive on change.
  const handleChange = (next: string) => {
    onChange(next);
    const result = next.trim() ? parseExternalLink(next) : null;
    onProvider(result?.provider ?? null);
    setTouched(true);
  };

  const invalid = touched && value.trim().length > 0 && !parsed;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="video-link" className="field-label">
          the link
        </label>
        <input
          id="video-link"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={() => setTouched(true)}
          className={cn('field', invalid && 'border-blush-deep/70')}
          aria-invalid={invalid}
          aria-describedby="video-link-help"
        />
      </div>

      <p id="video-link-help" className="text-[11px] leading-relaxed text-ink-faint">
        {helpText}
      </p>

      <AnimatePresence mode="wait">
        {parsed ? (
          <motion.div
            key={`${parsed.provider}-${parsed.id}`}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="overflow-hidden rounded-xl border border-cream-300 bg-cream-50"
          >
            {parsed.aspect === 'audio' ? (
              <iframe
                title={`${parsed.label} player`}
                src={parsed.embedUrl}
                height={152}
                loading="lazy"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                className="w-full"
              />
            ) : parsed.provider === 'youtube' ? (
              <div className="relative aspect-video w-full">
                <iframe
                  title="YouTube preview"
                  src={parsed.embedUrl}
                  loading="lazy"
                  allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="absolute inset-0 h-full w-full"
                />
              </div>
            ) : (
              <div className="relative mx-auto aspect-[9/16] max-h-[420px] w-full max-w-[260px]">
                <iframe
                  title={`${parsed.label} preview`}
                  src={parsed.embedUrl}
                  loading="lazy"
                  allow="encrypted-media; fullscreen; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="absolute inset-0 h-full w-full"
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-cream-300 bg-cream-100 px-3 py-2">
              <span className="font-round text-[11px] font-bold uppercase tracking-[0.14em] text-ink-soft">
                {parsed.label}
              </span>
              <span className="text-[11px] text-sage-deep">0 MB of our storage</span>
            </div>
          </motion.div>
        ) : invalid ? (
          <motion.p
            key="invalid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-blush-deep/40 bg-blush-light/60 px-3 py-2 text-xs text-blush-deep"
            role="alert"
          >
            That does not look like a YouTube, TikTok, Instagram Reel or Spotify link. We only embed
            those, so nothing else can sneak in.
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
