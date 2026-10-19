'use client';

import {
  BudgetError,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  TARGET_IMAGE_BYTES,
} from '@/lib/budget';

/**
 * Client-side image compression, BEFORE anything touches the network.
 *
 * Why this must happen in the browser and not in an API route:
 *   1. Vercel Hobby caps request bodies at ~4.5 MB. A 5 MB photo would be
 *      rejected by the platform before our code ever ran.
 *   2. Storage is the scarce resource (1 GB), not CPU. Shrinking on the client
 *      means the bytes never leave the phone in the first place — which also
 *      makes the app feel instant on a bad connection.
 *
 * The library is dynamically imported so `browser-image-compression` (~30 KB)
 * never lands in the initial JS bundle.
 */

export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
] as const;

export const IMAGE_ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif';

export interface CompressionResult {
  file: File;
  originalBytes: number;
  outputBytes: number;
  width?: number;
  height?: number;
  /** True when the file was already small enough to skip the round trip. */
  skipped: boolean;
}

function isAcceptedImage(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}

/** HEIC is the one format a browser may refuse to decode on canvas. */
function isLikelyUndecodable(type: string, name: string): boolean {
  const heic = type === 'image/heic' || type === 'image/heif' || /\.hei[cf]$/i.test(name);
  if (!heic) return false;
  const ua = navigator.userAgent;
  return !/Safari/i.test(ua); // Safari decodes HEIC; Chrome/Firefox generally do not
}

export async function compressImageFile(
  input: File,
  options: { maxEdge?: number; targetBytes?: number } = {},
): Promise<CompressionResult> {
  const maxEdge = options.maxEdge ?? MAX_IMAGE_EDGE;
  const targetBytes = options.targetBytes ?? TARGET_IMAGE_BYTES;

  if (!isAcceptedImage(input.type)) {
    throw new BudgetError(
      'type',
      'That file type is not allowed. Photos only — for video, paste a link instead.',
    );
  }

  // Rule 1: nothing over 5 MB is even considered. This is the number the prompt
  // asks for, and it matches the storage bucket's own file_size_limit.
  if (input.size > MAX_IMAGE_BYTES) {
    throw new BudgetError(
      'too_large',
      `That photo is ${(input.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB — try a screenshot or a smaller version.`,
    );
  }

  if (isLikelyUndecodable(input.type, input.name)) {
    throw new BudgetError(
      'heic',
      'This browser cannot read HEIC photos. Export it as JPEG first (or open the app in Safari).',
    );
  }

  // Already tiny? Do not re-encode and lose quality for no benefit.
  if (input.size <= targetBytes) {
    return {
      file: input,
      originalBytes: input.size,
      outputBytes: input.size,
      skipped: true,
    };
  }

  const { default: imageCompression } = await import('browser-image-compression');

  let compressed: File;
  try {
    compressed = await imageCompression(input, {
      maxSizeMB: targetBytes / (1024 * 1024),
      maxWidthOrHeight: maxEdge,
      useWebWorker: true,
      fileType: 'image/webp',
      initialQuality: 0.82,
      preserveExif: true, // keeps the little date stamp a camera wrote
    });
  } catch {
    // Never block a memory because of a codec quirk. Fall back to the original,
    // which is still under the hard 5 MB ceiling.
    return {
      file: input,
      originalBytes: input.size,
      outputBytes: input.size,
      skipped: true,
    };
  }

  // A compressed result must never be *bigger* or over the ceiling.
  if (compressed.size >= input.size || compressed.size > MAX_IMAGE_BYTES) {
    return {
      file: input,
      originalBytes: input.size,
      outputBytes: input.size,
      skipped: true,
    };
  }

  const renamed = new File([compressed], renameToWebp(input.name), {
    type: compressed.type || 'image/webp',
    lastModified: Date.now(),
  });

  return {
    file: renamed,
    originalBytes: input.size,
    outputBytes: renamed.size,
    skipped: false,
  };
}

function renameToWebp(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').slice(0, 60) || 'photo';
  return `${base}.webp`;
}

/**
 * Decode an image just far enough to read its dimensions. Used for the grid's
 * aspect-ratio placeholders so the scrapbook does not jump while loading.
 */
export function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 1, height: 1 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    case 'image/avif':
      return 'avif';
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    default:
      return 'jpg';
  }
}
