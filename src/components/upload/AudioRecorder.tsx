'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { AUDIO_BITRATE, BudgetError, formatBytes, MAX_AUDIO_SECONDS } from '@/lib/budget';
import { playPop } from '@/lib/sound';

export interface PreparedAudio {
  file: File;
  previewUrl: string;
  durationSeconds: number;
  bytes: number;
}

type Phase = 'idle' | 'requesting' | 'recording' | 'ready' | 'error';

const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(type: string): string {
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * 60-second voice memo.
 *
 * Why 60 seconds: at 32 kbps opus, a minute is ~240 KB — small enough that a
 * hundred voice notes still cost less than 25 MB. The limit is not arbitrary
 * cruelty; it is what makes audio safe to offer at all on a 1 GB budget.
 *
 * The timer is enforced twice: a visible countdown the user can see, and a hard
 * `recorder.stop()` at 60s that they cannot talk their way past.
 */
export function AudioRecorder({
  value,
  onChange,
  disabled,
}: {
  value: PreparedAudio | null;
  onChange: (next: PreparedAudio | null) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const mimeRef = useRef<string | undefined>(undefined);

  const teardown = useCallback(() => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = async () => {
    setError(null);
    setPhase('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new BudgetError('unsupported', 'This browser cannot record audio. Try Chrome or Safari.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1, // mono: half the bytes, nobody notices
        },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      mimeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: AUDIO_BITRATE,
      });
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const duration = Math.min(
          MAX_AUDIO_SECONDS,
          Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
        );
        const file = new File([blob], `voice-memo-${Date.now()}.${extensionFor(type)}`, {
          type,
          lastModified: Date.now(),
        });

        // ~1 MB expected, 2 MB hard stop. A long opus file should never hit this.
        if (file.size > 2 * 1024 * 1024) {
          setError('That recording came out too large. Try a shorter one.');
          setPhase('error');
          teardown();
          return;
        }

        onChange({
          file,
          previewUrl: URL.createObjectURL(file),
          durationSeconds: duration,
          bytes: file.size,
        });
        setPhase('ready');
        playPop(1.1);
        teardown();
      };

      recorder.start(1000); // 1s chunks, so a crash loses at most a second
      setPhase('recording');
      setSeconds(0);

      tickRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_AUDIO_SECONDS && recorderRef.current?.state === 'recording') {
          recorderRef.current.stop(); // the hard stop
        }
      }, 250);
    } catch (err) {
      teardown();
      setPhase('error');
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission was declined. Allow it in your browser settings, or use a note instead.'
          : err instanceof BudgetError
            ? err.message
            : 'Could not start recording. Check that a microphone is connected.',
      );
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  };

  const reset = () => {
    if (value) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
    setSeconds(0);
    setPhase('idle');
    setError(null);
  };

  const remaining = Math.max(0, MAX_AUDIO_SECONDS - seconds);
  const progress = Math.min(1, seconds / MAX_AUDIO_SECONDS);

  return (
    <div className="space-y-3">
      <div className="relative rounded-2xl border-2 border-dashed border-cream-300 bg-cream-100 p-5">
        <div className="flex items-center gap-4">
          {/* the countdown ring */}
          <div className="relative grid h-16 w-16 shrink-0 place-items-center">
            <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(74,63,53,.12)" strokeWidth="2.5" />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke={progress > 0.85 ? '#D98C86' : '#7E9B78'}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${progress * 97.4} 97.4`}
              />
            </svg>
            {phase === 'recording' ? (
              <motion.span
                animate={{ scale: [1, 1.16, 1], opacity: [1, 0.75, 1] }}
                transition={{ repeat: Infinity, duration: 1.2 }}
                className="text-lg"
              >
                🎙️
              </motion.span>
            ) : (
              <span className="font-round text-xs font-bold tabular-nums text-ink-soft">
                {phase === 'ready' ? '✓' : `0:${String(MAX_AUDIO_SECONDS).padStart(2, '0')}`}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {phase === 'recording' ? (
              <>
                <p className="font-round text-sm font-semibold text-ink">
                  Recording… {remaining}s left
                </p>
                <p className="text-xs text-ink-faint">It stops itself at a minute. Promise.</p>
              </>
            ) : phase === 'ready' && value ? (
              <>
                <p className="font-round text-sm font-semibold text-ink">
                  {value.durationSeconds}s · {formatBytes(value.bytes)}
                </p>
                <audio src={value.previewUrl} controls className="mt-1 h-9 w-full max-w-[18rem]" />
              </>
            ) : (
              <>
                <p className="font-round text-sm font-semibold text-ink">leave a voice note</p>
                <p className="text-xs leading-relaxed text-ink-faint">
                  Up to 60 seconds · about 240 KB. Say the thing you would only say out loud.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {phase === 'recording' ? (
            <BouncyButton size="sm" tone="cardboard" onClick={stop} sound={false}>
              ⏹ stop
            </BouncyButton>
          ) : phase === 'ready' ? (
            <BouncyButton size="sm" tone="ghost" onClick={reset}>
              re-record
            </BouncyButton>
          ) : (
            <BouncyButton
              size="sm"
              tone="sage"
              onClick={() => void start()}
              loading={phase === 'requesting'}
              disabled={disabled}
            >
              🎙️ start recording
            </BouncyButton>
          )}
        </div>
      </div>

      <AnimatePresence>
        {error ? (
          <motion.p
            key="err"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="rounded-xl border border-blush-deep/40 bg-blush-light/70 px-3 py-2 text-xs text-blush-deep"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
