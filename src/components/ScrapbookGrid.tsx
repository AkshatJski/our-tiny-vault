'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { PaperCard } from '@/components/ui/PaperCard';
import { CornerFold, PinDot, SketchyFrame, WashiTape } from '@/components/ui/PaperBits';
import { signedMediaUrl } from '@/lib/contributions';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { parseExternalLink } from '@/lib/video-link';
import type { ContributionWithAuthor } from '@/lib/types';
import { cn, formatRelative, truncate } from '@/lib/utils';
import { formatBytes } from '@/lib/budget';

/**
 * The scrapbook.
 *
 * Every media URL is a short-lived signed URL requested at render time — the
 * bucket is private and stays private. `createSignedUrl` is itself gated by the
 * storage SELECT policy, so this component simply gets `null` back for anything
 * the viewer is not allowed to see. No client-side permission logic required.
 *
 * Layout is CSS multi-column, not a JS masonry library: 0 KB of JS, no layout
 * thrash while images decode, and `break-inside-avoid` is enough to stop cards
 * being sliced in half.
 */
export function ScrapbookGrid({
  contributions,
  className,
}: {
  contributions: ContributionWithAuthor[];
  className?: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  const filePaths = useMemo(
    () =>
      contributions
        .filter((item) => item.storage_path)
        .map((item) => item.storage_path as string),
    [contributions],
  );

  useEffect(() => {
    let cancelled = false;
    const supabase = getBrowserSupabase();

    void (async () => {
      const entries = await Promise.all(
        filePaths.map(async (path) => [path, await signedMediaUrl(supabase, path, 900)] as const),
      );
      if (cancelled) return;
      setUrls(
        Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [filePaths]);

  if (contributions.length === 0) {
    return (
      <div className="relative grid place-items-center rounded-2xl border-2 border-dashed border-cream-300 bg-cream-100 px-6 py-14 text-center">
        <SketchyFrame radius={16} dashed stroke="rgba(200,159,115,.45)" />
        <span className="text-3xl">🫙</span>
        <p className="mt-2 font-round text-sm font-semibold text-ink">The vault came up empty</p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-faint">
          Nobody sealed anything before the clock ran out. You still have each other, which was
          arguably the point.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('columns-1 gap-5 sm:columns-2 lg:columns-3', className)}>
      {contributions.map((item, index) => (
        <div key={item.id} className="mb-5 break-inside-avoid">
          <ScrapbookCard contribution={item} mediaUrl={item.storage_path ? urls[item.storage_path] : undefined} index={index} />
        </div>
      ))}
    </div>
  );
}

function ScrapbookCard({
  contribution,
  mediaUrl,
  index,
}: {
  contribution: ContributionWithAuthor;
  mediaUrl?: string;
  index: number;
}) {
  const author = contribution.author;
  const accent = author?.accent_color ?? '#F4C7C3';
  // Alternating paper tones make a long scroll feel like flipped pages.
  const paperTone = ['bg-cream-50', 'bg-butter-light', 'bg-sage-light', 'bg-blush-light'][index % 4];

  return (
    <PaperCard
      seed={contribution.id}
      tilt={0}
      className={cn('overflow-hidden p-3', paperTone)}
    >
      <SketchyFrame radius={16} soft stroke="rgba(74,63,53,.18)" />
      {index % 3 === 0 ? <WashiTape className="-top-1.5 left-8" rotate={-5} width={64} /> : null}
      <CornerFold />

      {/* the little "whose is this" strip */}
      <div className="mb-2 flex items-center gap-2 px-1">
        <span
          className="grid h-6 w-6 place-items-center rounded-full border border-ink/10 text-[12px]"
          style={{ background: accent }}
          aria-hidden="true"
        >
          {author?.avatar_emoji ?? '🫧'}
        </span>
        <span className="font-round text-[12px] font-semibold text-ink">
          {author?.display_name ?? 'someone'}
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          {formatRelative(contribution.created_at)}
        </span>
      </div>

      <ContributionBody contribution={contribution} mediaUrl={mediaUrl} />
    </PaperCard>
  );
}

function ContributionBody({
  contribution,
  mediaUrl,
}: {
  contribution: ContributionWithAuthor;
  mediaUrl?: string;
}) {
  const { kind, body } = contribution;

  if (kind === 'photo') {
    return (
      <figure className="m-0">
        {mediaUrl ? (
          <motion.img
            src={mediaUrl}
            alt={body ?? 'A photo sealed in the capsule'}
            loading="lazy"
            decoding="async"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="w-full rounded-lg border border-cream-300 object-cover"
          />
        ) : (
          <div className="grid h-40 place-items-center rounded-lg border border-dashed border-cream-300 bg-cream-100 text-xs text-ink-faint">
            🫧 loading the photo…
          </div>
        )}
        {body ? (
          <figcaption className="mt-2 px-1 text-[12px] leading-relaxed text-ink-soft">{body}</figcaption>
        ) : null}
        <p className="mt-1 px-1 text-[10px] text-ink-faint">{formatBytes(contribution.byte_size)}</p>
      </figure>
    );
  }

  if (kind === 'audio') {
    return (
      <div className="px-1">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-lg">🎙️</span>
          <span className="font-round text-[12px] font-semibold text-ink">
            {(contribution.duration_seconds ?? 60) < 10 ? '0' : ''}
            {Math.floor((contribution.duration_seconds ?? 60) / 60)}:
            {String((contribution.duration_seconds ?? 60) % 60).padStart(2, '0')}
          </span>
          <span className="text-[10px] text-ink-faint">{formatBytes(contribution.byte_size)}</span>
        </div>
        {mediaUrl ? (
          <audio src={mediaUrl} controls preload="none" className="w-full" />
        ) : (
          <div className="grid h-10 place-items-center rounded-lg border border-dashed border-cream-300 bg-cream-100 text-[11px] text-ink-faint">
            loading the voice note…
          </div>
        )}
        {body ? <p className="mt-2 text-[12px] text-ink-soft">{body}</p> : null}
      </div>
    );
  }

  if (kind === 'video_link' || kind === 'playlist_link') {
    const parsed = contribution.external_url ? parseExternalLink(contribution.external_url) : null;
    return (
      <div className="px-1">
        {parsed ? (
          parsed.aspect === 'audio' ? (
            <iframe
              title="Sealed playlist"
              src={parsed.embedUrl}
              height={152}
              loading="lazy"
              className="w-full rounded-lg border border-cream-300"
            />
          ) : (
            <div className={cn('relative w-full overflow-hidden rounded-lg border border-cream-300', parsed.aspect === 'video' ? 'aspect-video' : 'aspect-[9/16] max-h-[380px] mx-auto max-w-[240px]')}>
              <iframe
                title={parsed.label}
                src={parsed.embedUrl}
                loading="lazy"
                allow="encrypted-media; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                className="absolute inset-0 h-full w-full"
              />
            </div>
          )
        ) : (
          <p className="text-[12px] text-ink-faint">A link that no longer parses.</p>
        )}
        {body ? <p className="mt-2 text-[12px] text-ink-soft">{body}</p> : null}
        <p className="mt-1 text-[10px] text-sage-deep">embedded · 0 MB</p>
      </div>
    );
  }

  // note / doodle
  return (
    <div className="relative px-1">
      <PinDot className="right-2 top-0" />
      <p className="paper-ruled whitespace-pre-wrap py-1 pl-3 font-sketch text-[14px] leading-7 text-ink">
        {body ? truncate(body, 4000) : ''}
      </p>
    </div>
  );
}
