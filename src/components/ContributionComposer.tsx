'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame, WashiTape } from '@/components/ui/PaperBits';
import { ImageUploader, type PreparedImage } from '@/components/upload/ImageUploader';
import { AudioRecorder, type PreparedAudio } from '@/components/upload/AudioRecorder';
import { VideoLinkField } from '@/components/upload/VideoLinkField';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { discardOrphanUpload, sealContribution, uploadCapsuleMedia } from '@/lib/contributions';
import { parseExternalLink, LINK_HELP_TEXT, PLAYLIST_HELP_TEXT } from '@/lib/video-link';
import type { ContributionKind, ContributionWithAuthor, ExternalProvider, Profile } from '@/lib/types';
import { cn, friendlyError, truncate } from '@/lib/utils';
import { playCrinkle, playPop } from '@/lib/sound';

type Mode = 'note' | 'photo' | 'audio' | 'video_link' | 'playlist_link';

type BundleItem = {
  id: string;
  mode: Mode;
  body: string;
  image: PreparedImage | null;
  audio: PreparedAudio | null;
  linkUrl: string;
  linkProvider: ExternalProvider | null;
};

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
  const [showSealGuide, setShowSealGuide] = useState(false);
  const [bundle, setBundle] = useState<BundleItem[]>([]);

  const resetCurrent = () => {
    setBody('');
    setImage(null);
    setAudio(null);
    setLinkUrl('');
    setLinkProvider(null);
  };

  const canAddToBundle = (() => {
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

  const canSubmitCurrent = canAddToBundle && bundle.length === 0;
  const canSubmitBundle = (bundle.length > 0 || canSubmitCurrent) && !busy && !disabled;

  const addToBundle = () => {
    if (!canAddToBundle) return;
    const item: BundleItem = {
      id: crypto.randomUUID(),
      mode,
      body: body.trim(),
      image,
      audio,
      linkUrl,
      linkProvider,
    };
    setBundle((prev) => [...prev, item]);
    resetCurrent();
    playPop(0.6);
  };

  const removeFromBundle = (id: string) => {
    setBundle((prev) => prev.filter((i) => i.id !== id));
  };

  const clearBundle = () => {
    setBundle([]);
  };

  const sealItem = async (item: BundleItem) => {
    const supabase = getBrowserSupabase();
    const kind: ContributionKind = item.mode;

    if (item.mode === 'photo' || item.mode === 'audio') {
      const prepared = item.mode === 'photo' ? item.image : item.audio;
      if (!prepared) throw new Error('Nothing selected.');

      const uploaded = await uploadCapsuleMedia(supabase, {
        capsuleId,
        userId: profile.id,
        file: prepared.file,
      });

      const sealed = await sealContribution(
        supabase,
        {
          capsuleId,
          authorId: profile.id,
          kind,
          body: item.body || null,
          storagePath: uploaded.path,
          mimeType: uploaded.mimeType,
          byteSize: uploaded.byteSize,
          durationSeconds: item.mode === 'audio' ? (prepared as PreparedAudio).durationSeconds : null,
        },
        {
          id: profile.id,
          handle: profile.handle,
          display_name: profile.display_name,
          avatar_emoji: profile.avatar_emoji,
          accent_color: profile.accent_color,
        },
      ).catch(async (error) => {
        // Uploaded, but the row was refused (quota, RLS, offline). Take the
        // bytes back out; nobody could ever reach them again. See
        // `discardOrphanUpload` for why this matters.
        await discardOrphanUpload(supabase, uploaded.path);
        throw error;
      });

      return { contribution: sealed.contribution, receipt: item.mode === 'photo' ? `photo · ${Math.max(1, Math.round(uploaded.byteSize / 1024))} KB` : `voice · ${(prepared as PreparedAudio).durationSeconds}s` };
    } else if (item.mode === 'video_link' || item.mode === 'playlist_link') {
      const parsed = parseExternalLink(item.linkUrl);
      if (!parsed) throw new Error('That link is not one we can embed.');

      const { contribution } = await sealContribution(
        supabase,
        {
          capsuleId,
          authorId: profile.id,
          kind,
          body: item.body || null,
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
      return { contribution, receipt: `${parsed.label} link` };
    } else {
      const { contribution } = await sealContribution(
        supabase,
        {
          capsuleId,
          authorId: profile.id,
          kind: 'note',
          body: item.body,
        },
        {
          id: profile.id,
          handle: profile.handle,
          display_name: profile.display_name,
          avatar_emoji: profile.avatar_emoji,
          accent_color: profile.accent_color,
        },
      );
      return { contribution, receipt: 'note' };
    }
  };

  const submitBundle = async () => {
    if (bundle.length === 0 && !canSubmitCurrent) return;
    setError(null);
    setBusy(true);

    const isDirect = bundle.length === 0;

    try {
      const itemsToSeal: BundleItem[] = isDirect
        ? [{
            id: crypto.randomUUID(),
            mode,
            body: body.trim(),
            image,
            audio,
            linkUrl,
            linkProvider,
          }]
        : bundle;

      const sealed: Array<{ item: BundleItem; receipt: string }> = [];

      for (const item of itemsToSeal) {
        try {
          const res = await sealItem(item);
          sealed.push({ item, receipt: res.receipt });
          onSealed?.(res.contribution);
        } catch (err) {
          // Whatever already got through stays sealed for real — drop those from
          // the bundle so a retry cannot duplicate them.
          const done = sealed.length;
          if (!isDirect && done > 0) {
            const doneIds = new Set(sealed.map((entry) => entry.item.id));
            setBundle((prev) => prev.filter((entry) => !doneIds.has(entry.id)));
          }

          const raw = err instanceof Error ? err.message : String(err);
          const locked = /row-level security|42501|AccessDenied/i.test(raw);
          const failure = isDirect
            ? `Could not seal your ${item.mode}.`
            : `${done} of ${itemsToSeal.length} sealed — the ${item.mode} did not.`;

          setError(
            locked
              ? `${failure} The vault is not accepting new things right now — it may have already opened.`
              : `${failure} ${friendlyError(err)}`,
          );
          playPop(0.7);
          return;
        }
      }

      const count = sealed.length;
      setReceipt(
        count === 1
          ? `Sealed your ${sealed[0]?.receipt}`
          : `Sealed a bundle of ${count} things — they'll show up as separate cards in the scrapbook`,
      );
      playCrinkle(0.7);
      if (isDirect) {
        resetCurrent();
      } else {
        clearBundle();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative rounded-2xl border border-cream-300 bg-cream-50 p-5 shadow-paper sm:p-6">
      <SketchyFrame radius={18} soft stroke="rgba(74,63,53,.22)" />
      <WashiTape className="-top-2 left-6" rotate={-3} width={78} />

      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="font-round text-lg font-bold text-ink">seal something in</h3>
          <button
            type="button"
            onClick={() => setShowSealGuide((v) => !v)}
            className="mt-1 text-[11px] text-cardboard-deep underline decoration-dotted underline-offset-2 hover:text-ink"
          >
            {showSealGuide ? 'hide how sealing works' : 'how does sealing work?'}
          </button>
        </div>
        <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {profile.avatar_emoji} {profile.display_name}
        </span>
      </div>

      <AnimatePresence>
        {showSealGuide ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 overflow-hidden rounded-xl border border-butter-deep/40 bg-butter-light/60 p-3 text-[12px] leading-relaxed text-ink-soft"
          >
            <p className="font-round text-xs font-semibold text-cardboard-deep">The seal is the whole point</p>
            <ul className="mt-2 space-y-1.5">
              <li>• <span className="font-semibold text-ink">Pick your format</span> — note, photo, voice, video link, or playlist</li>
              <li>• <span className="font-semibold text-ink">Add everything you want now</span> — once sealed, you cannot edit or delete it until unlock</li>
              <li>• <span className="font-semibold text-ink">Photos/voice upload directly</span> — files go straight to storage, encrypted by the vault</li>
              <li>• <span className="font-semibold text-ink">Links embed on open</span> — we just store the link, no uploads needed</li>
              <li>• <span className="font-semibold text-ink">What you seal stays hidden</span> — even you can&apos;t read it back until the day it opens</li>
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
          <div>
            <p className="mb-2 text-[12px] text-ink-soft">Add a photo to seal in your vault</p>
            <ImageUploader value={image} onChange={setImage} disabled={busy || disabled} />
          </div>
        ) : null}

        {mode === 'audio' ? (
          <div>
            <p className="mb-2 text-[12px] text-ink-soft">Record or upload a voice note (up to 60s)</p>
            <AudioRecorder value={audio} onChange={setAudio} disabled={busy || disabled} />
          </div>
        ) : null}

        {mode === 'video_link' ? (
          <div>
            <p className="mb-2 text-[12px] text-ink-soft">Paste a video link to seal (YouTube, Vimeo, etc.)</p>
            <VideoLinkField
              value={linkUrl}
              onChange={setLinkUrl}
              provider={linkProvider}
              onProvider={setLinkProvider}
              helpText={LINK_HELP_TEXT}
              disabled={busy || disabled}
            />
          </div>
        ) : null}

        {mode === 'playlist_link' ? (
          <div>
            <p className="mb-2 text-[12px] text-ink-soft">Paste a playlist link for the soundtrack of now</p>
            <VideoLinkField
              value={linkUrl}
              onChange={setLinkUrl}
              provider={linkProvider}
              onProvider={setLinkProvider}
              helpText={PLAYLIST_HELP_TEXT}
              placeholder="https://open.spotify.com/playlist/…"
              disabled={busy || disabled}
            />
          </div>
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

      {bundle.length > 0 ? (
        <div className="mt-4 rounded-xl border border-cream-300 bg-cream-100 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-round text-xs font-semibold text-cardboard-deep">
              Bundle ({bundle.length}) — each will become its own card
            </p>
            <button
              type="button"
              onClick={clearBundle}
              disabled={busy}
              className="text-[11px] text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink disabled:opacity-50"
            >
              clear all
            </button>
          </div>
          <ul className="space-y-1.5">
            {bundle.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-cream-50/80 px-2 py-1.5">
                <span className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                  <span>{MODES.find((m) => m.id === item.mode)?.icon}</span>
                  <span className="font-medium capitalize">{item.mode.replace('_', ' ')}</span>
                  {item.mode === 'photo' && item.image && (
                    <span className="text-ink-faint">({Math.max(1, Math.round(item.image.file.size / 1024))} KB)</span>
                  )}
                  {item.mode === 'audio' && item.audio && (
                    <span className="text-ink-faint">({Math.max(0, Math.floor(item.audio.durationSeconds))}s)</span>
                  )}
                  {item.body && <span className="truncate text-ink-faint">· “{truncate(item.body, 40)}”</span>}
                </span>
                <button
                  type="button"
                  onClick={() => removeFromBundle(item.id)}
                  disabled={busy}
                  className="text-[11px] text-blush-deep hover:text-blush-strong disabled:opacity-50"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-[16rem] space-y-1">
          <p className="text-[11px] leading-relaxed text-ink-faint">
            {MODES.find((item) => item.id === mode)?.hint}
          </p>
          {!canAddToBundle && bundle.length === 0 && !busy && !disabled ? (
            <p className="text-[11px] font-semibold text-cardboard-deep">
              {mode === 'note' && 'Add a few words to seal'}
              {mode === 'photo' && 'Pick a photo to seal'}
              {mode === 'audio' && 'Record or upload audio to seal'}
              {mode === 'video_link' && 'Paste a supported video link'}
              {mode === 'playlist_link' && 'Paste a supported playlist link'}
            </p>
          ) : null}
          {canAddToBundle && (
            <p className="text-[11px] font-semibold text-sage-deep">
              Looks ready! Add to bundle or seal it all at once.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bundle.length > 0 || canAddToBundle ? (
            <BouncyButton
              tone="ghost"
              size="sm"
              onClick={addToBundle}
              disabled={!canAddToBundle}
              loading={false}
            >
              + add to bundle
            </BouncyButton>
          ) : null}
          <BouncyButton
            tone="blush"
            size="md"
            onClick={() => void submitBundle()}
            disabled={!canSubmitBundle}
            loading={busy}
          >
            {busy ? 'sealing…' : bundle.length === 0 ? 'seal it in' : bundle.length === 1 ? 'seal it in' : `seal ${bundle.length} things`}
          </BouncyButton>
        </div>
      </div>
    </div>
  );
}
