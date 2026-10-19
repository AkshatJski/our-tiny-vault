'use client';

import { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame } from '@/components/ui/PaperBits';
import { compressImageFile, IMAGE_ACCEPT_ATTR, readImageSize } from '@/lib/compression';
import { BudgetError, formatBytes, MAX_IMAGE_BYTES } from '@/lib/budget';
import { cn } from '@/lib/utils';
import { playCrinkle } from '@/lib/sound';

export interface PreparedImage {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  originalBytes: number;
  outputBytes: number;
  skipped: boolean;
}

/**
 * Photo picker with compression built into the flow, not bolted on after.
 *
 * The user sees the before/after number ("4.8 MB → 240 KB") because that is the
 * moment they understand the rule. Silently shrinking someone's photo feels like
 * a bug; showing the saving feels like a feature — and it is the reason a
 * 1 GB vault can hold thousands of photos.
 *
 * There is deliberately NO video input anywhere in this component.
 */
export function ImageUploader({
  value,
  onChange,
  disabled,
}: {
  value: PreparedImage | null;
  onChange: (next: PreparedImage | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setBusy(true);
      try {
        const result = await compressImageFile(file);
        const size = await readImageSize(result.file);
        onChange({
          file: result.file,
          previewUrl: URL.createObjectURL(result.file),
          width: size.width,
          height: size.height,
          originalBytes: result.originalBytes,
          outputBytes: result.outputBytes,
          skipped: result.skipped,
        });
        playCrinkle(0.35);
      } catch (err) {
        setError(
          err instanceof BudgetError
            ? err.message
            : 'That photo could not be read. Try a JPEG or PNG.',
        );
        onChange(null);
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const clear = () => {
    if (value) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {!value ? (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cn(
            'relative grid w-full place-items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging ? 'border-cardboard bg-butter-light/60' : 'border-cream-300 bg-cream-100 hover:bg-cream-200/60',
            disabled && 'opacity-60',
          )}
        >
          <SketchyFrame radius={16} dashed stroke="rgba(200,159,115,.5)" />
          <span className="text-2xl">{busy ? '🫧' : '📷'}</span>
          <span className="font-round text-sm font-semibold text-ink">
            {busy ? 'squishing your photo…' : 'drop a photo here'}
          </span>
          <span className="max-w-[22rem] text-xs leading-relaxed text-ink-faint">
            5 MB max, then shrunk to ~300 KB before it leaves your phone. Big files never touch
            the network.
          </span>
        </button>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 p-3">
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value.previewUrl}
              alt="Your photo, ready to be sealed"
              className="h-28 w-28 shrink-0 rounded-xl object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-round text-sm font-semibold text-ink">{value.file.name}</p>
              <p className="mt-1 text-xs text-ink-soft">
                {formatBytes(value.originalBytes)}
                {value.skipped ? (
                  <span className="text-ink-faint"> · already small enough</span>
                ) : (
                  <>
                    {' → '}
                    <span className="font-bold text-sage-deep">{formatBytes(value.outputBytes)}</span>
                    <span className="text-ink-faint">
                      {' '}
                      · saved {Math.max(0, Math.round((1 - value.outputBytes / value.originalBytes) * 100))}%
                    </span>
                  </>
                )}
              </p>
              <p className="mt-1 text-[11px] text-ink-faint">
                {value.width}×{value.height} px · webp
              </p>
              <div className="mt-2 flex gap-2">
                <BouncyButton size="sm" tone="ghost" onClick={() => inputRef.current?.click()} disabled={disabled}>
                  swap
                </BouncyButton>
                <BouncyButton size="sm" tone="ghost" onClick={clear} disabled={disabled}>
                  remove
                </BouncyButton>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-blush-deep/40 bg-blush-light/70 px-3 py-2 text-xs text-blush-deep"
            role="alert"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <p className="text-[11px] leading-relaxed text-ink-faint">
        Hard ceiling {formatBytes(MAX_IMAGE_BYTES)} per photo, enforced here and again in the
        database. Videos are links, never uploads.
      </p>
    </div>
  );
}
