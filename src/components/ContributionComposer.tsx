'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame, WashiTape } from '@/components/ui/PaperBits';
import { ImageUploader, type PreparedImage } from '@/components/upload/ImageUploader';
import { AudioRecorder, type PreparedAudio } from '@/components/upload/AudioRecorder';
import { VideoLinkField } from '@/components/upload/VideoLinkField';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { sealContribution, uploadCapsuleMedia } from '@/lib/contributions';
import { parseExternalLink, LINK_HELP_TEXT, PLAYLIST_HELP_TEXT } from '@/lib/video-link';
import type { ContributionKind, ContributionWithAuthor, ExternalProvider, Profile } from '@/lib/types';
import { cn, friendlyError, truncate } from '@/lib/utils';
import { playCrinkle, playPop } from '@/lib/sound';

type Mode = 'note' | 'photo' | 'audio' | 'video_link' | 'playlist_link';

const MODES: Array<{ id: Mode; label: string; icon: string; hint: string }> = [
  { id: 'note', label: 'note', icon: '✍️', hint: 'a few words, sealed until later' },
  { id: 'photo', label: 'photo', icon: '📷', hint: 'compressed before upload' },
  { id: 'audio', label: 'voice', icon: '🎙️', hint: '60 seconds, max' },
  { id: 'video_link', label: 'video link', icon: '🔗', hint: 'embedded, never uploaded' },
  { id: 'playlist_link', label: 'playlist', icon: '🎧', hint: 'the soundtrack of now' },
];

/**
 * The composer. Everything that goes into a sealed capsule is written here.
 *
 * Two things to notice:
 *   • Photos and voice notes are uploaded straight from the browser to Supabase
 *     Storage with the user's own session. They never pass through a Vercel
 *     function, so the 4.5 MB Hobby request-body limit never applies and we
 *     spend 0 function invocations moving bytes.
 *   • After a successful save the composer shows a *local* receipt. It cannot
 *     show the server row, because reading it is forbidden until unlock — that
 *     is the RLS rule working as intended, not a bug.
 */
export function ContributionComposer({
  capsuleId,
  profile,
  onSealed,
  disabled = false,
}: {
  capsuleId: string;
  profile: Pick<Profile, 'id' | 'handle' | 'display_name' | 'avatar_emoji' | 'accent_color'>;
  onSealed?: (contribution: ContributionWithAuthor) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('note');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [audio, setAudio] = useState<PreparedAudio | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkProvider, setLinkProvider] = useState<ExternalProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const reset = () => {
    setBody('');
    if (image) URL.revokeObjectURL(image.previewUrl);
    setImage(null);
    if (audio) URL.revokeObjectURL(audio.previewUrl);
    setAudio(null);
    setLinkUrl('');
    setLinkProvider(null);
  };

  const canSubmit = (() => {
    if (busy || disabled) return false;
    switch (mode) {
      case 'note':
        return body.trim().length > 0;
      case 'photo':
        return Boolean(image);
      case 'audio':
        return Boolean(audio);
      case 'video_link':
      case 'playlist_link':
        return Boolean(parseExternalLink(linkUrl));
    }
  })();

  const submit = async () => {
    setError(null);
    setBusy(true);
    const supabase = getBrowserSupabase();

    try {
      const kind: ContributionKind = mode;

      // ── files go browser -> storage, never through a serverless function ──
      if (mode === 'photo' || mode === 'audio') {
        const prepared = mode === 'photo' ? image : audio;
        if (!prepared) throw new Error('Nothing selected.');

        const uploaded = await uploadCapsuleMedia(supabase, {
          capsuleId,
          userId: profile.id,
          file: prepared.file,
        });

        const { contribution } = await sealContribution(
          supabase,
          {
            capsuleId,
            authorId: profile.id,
            kind,
            body: body.trim() || null,
            storagePath: uploaded.path,
            mimeType: uploaded.mimeType,
            byteSize: uploaded.byteSize,
            durationSeconds: mode === 'audio' ? (prepared as PreparedAudio).durationSeconds : null,
          },
          {
            id: profile.id,
            handle: profile.handle,
            display_name: profile.display_name,
            avatar_emoji: profile.avatar_emoji,
            accent_color: profile.accent_color,
          },
        );
        onSealed?.(contribution);
        setReceipt(
          mode === 'photo'
            ? `Sealed a photo · ${Math.max(1, Math.round(uploaded.byteSize / 1024))} KB`
            : `Sealed ${(prepared as PreparedAudio).durationSeconds}s of your voice`,
        );
      } else if (mode === 'video_link' || mode === 'playlist_link') {
        const parsed = parseExternalLink(linkUrl);
        if (!parsed) throw new Error('That link is not one we can embed.');

        const { contribution } = await sealContribution(
          supabase,
          {
            capsuleId,
            authorId: profile.id,
            kind,
            body: body.trim() || null,
            externalUrl: parsed.canonicalUrl,
            externalProvider: parsed.provider,
          },
          {
            id: profile.id,
            handle: profile.handle,
            display_name: profile.display_name,
            avatar_emoji: profile.avatar_emoji,
            accent_color: profile.accent_color,
          },
        );
        onSealed?.(contribution);
        setReceipt(`Sealed a ${parsed.label} link · 0 bytes`);
      } else {
        const { contribution } = await sealContribution(
          supabase,
          {
            capsuleId,
            authorId: profile.id,
            kind: 'note',
            body: body.trim(),
          },
          {
            id: profile.id,
            handle: profile.handle,
            display_name: profile.display_name,
            avatar_emoji: profile.avatar_emoji,
            accent_color: profile.accent_color,
          },
        );
        onSealed?.(contribution);
        setReceipt('Sealed your note');
      }

      playCrinkle(0.6);
      reset();
    } catch (err) {
      setError(friendlyError(err));
      playPop(0.7);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-paper sm:p-6">
      <SketchyFrame radius={18} soft stroke="rgba(74,63,53,.22)" />
      <WashiTape className="-top-2 left-6" rotate={-3} width={78} />

      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="font-round text-lg font-bold text-ink">seal something in</h3>
        <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {profile.avatar_emoji} {profile.display_name}
        </span>
      </div>

      {/* ── mode picker ─────────────────────────────────────────────────── */}
      <div className="no-scrollbar -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {MODES.map((item) => {
          const active = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setMode(item.id);
                setError(null);
                if (item.id !== 'video_link' && item.id !== 'playlist_link') {
                  setLinkUrl('');
                  setLinkProvider(null);
                }
              }}
              className={cn(
                'relative shrink-0 rounded-full border px-3 py-1.5 font-round text-[12px] font-semibold transition-colors',
                active
                  ? 'border-cardboard/60 bg-butter text-cardboard-deep shadow-paper-inset'
                  : 'border-cream-300 bg-cream-100 text-ink-soft hover:bg-cream-200',
              )}
              aria-pressed={active}
            >
              <span className="mr-1">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        {mode === 'photo' ? (
          <ImageUploader value={image} onChange={setImage} disabled={busy || disabled} />
        ) : null}

        {mode === 'audio' ? (
          <AudioRecorder value={audio} onChange={setAudio} disabled={busy || disabled} />
        ) : null}

        {mode === 'video_link' ? (
          <VideoLinkField
            value={linkUrl}
            onChange={setLinkUrl}
            provider={linkProvider}
            onProvider={setLinkProvider}
            helpText={LINK_HELP_TEXT}
            disabled={busy || disabled}
          />
        ) : null}

        {mode === 'playlist_link' ? (
          <VideoLinkField
            value={linkUrl}
            onChange={setLinkUrl}
            provider={linkProvider}
            onProvider={setLinkProvider}
            helpText={PLAYLIST_HELP_TEXT}
            placeholder="https://open.spotify.com/playlist/…"
            disabled={busy || disabled}
          />
        ) : null}

        {mode === 'note' || mode === 'photo' || mode === 'audio' || mode.startsWith('video') || mode === 'playlist_link' ? (
          <div>
            <label htmlFor="contribution-body" className="field-label">
              {mode === 'note'
                ? 'your words'
                : mode === 'playlist_link'
                  ? 'why this song?'
                  : 'a caption (optional)'}
            </label>
            <textarea
              id="contribution-body"
              value={body}
              onChange={(event) => setBody(event.target.value.slice(0, 4000))}
              rows={mode === 'note' ? 5 : 2}
              maxLength={4000}
              disabled={busy || disabled}
              placeholder={
                mode === 'note'
                  ? 'Dear future us, I hope you still…'
                  : 'Optional. A line so past-you is not a stranger.'
              }
              className="field resize-none paper-ruled leading-7"
            />
            <div className="mt-1 flex justify-end text-[11px] text-ink-faint">
              {body.length}/4000
            </div>
          </div>
        ) : null}
      </div>

      <AnimatePresence>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="mt-3 rounded-xl border border-blush-deep/40 bg-blush-light/70 px-3 py-2 text-xs leading-relaxed text-blush-deep"
          >
            {error}
          </motion.p>
        ) : null}

        {receipt ? (
          <motion.div
            key={receipt}
            initial={{ opacity: 0, y: 8, rotate: -1 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            className="mt-3 rounded-xl border border-sage-deep/40 bg-sage-light/70 px-3 py-2.5 text-xs text-sage-deep"
          >
            <span className="font-bold">{truncate(receipt, 60)}.</span>{' '}
            It is in the vault now — you will not be able to read it back until the capsule opens.
            That is the whole point.
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="max-w-[16rem] text-[11px] leading-relaxed text-ink-faint">
          {MODES.find((item) => item.id === mode)?.hint}
        </p>
        <BouncyButton
          tone="blush"
          size="md"
          onClick={() => void submit()}
          disabled={!canSubmit}
          loading={busy}
        >
          {busy ? 'sealing…' : 'seal it in'}
        </BouncyButton>
      </div>
    </div>
  );
}
