import type { ExternalProvider } from '@/lib/types';

/**
 * Video is a LINK, never a file.
 *
 * A single 30-second phone video (≈60 MB) would eat 6% of the entire free 1 GB
 * and take minutes to upload on mobile data. An embed costs zero bytes, loads
 * from the provider's CDN, and survives our project being deleted.
 *
 * Security note: we do not accept arbitrary URLs. `parseExternalLink` returns
 * null for anything it does not recognise, and the embed URL is *constructed*
 * from a validated id — never taken from the user's string. That closes the
 * "iframe src=javascript:" class of bug before it can exist.
 */

export interface ParsedExternalLink {
  provider: ExternalProvider;
  /** Provider-side id (YouTube video id, TikTok post id, IG shortcode, Spotify id). */
  id: string;
  /** Cleaned canonical URL, safe to store. */
  canonicalUrl: string;
  /** Only URLs built from the validated id appear here. */
  embedUrl: string;
  /** 16:9-friendly hint for the card layout. */
  aspect: 'video' | 'square' | 'audio';
  label: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const TIKTOK_ID = /^\d{6,25}$/;
const IG_CODE = /^[A-Za-z0-9_-]{5,30}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{10,40}$/;

function safeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

export function parseExternalLink(raw: string): ParsedExternalLink | null {
  const url = safeUrl(raw);
  if (!url) return null;

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  // ── YouTube ───────────────────────────────────────────────────────────────
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    let id = '';
    if (host === 'youtu.be') {
      id = url.pathname.slice(1).split('/')[0] ?? '';
    } else if (url.pathname === '/watch') {
      id = url.searchParams.get('v') ?? '';
    } else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      id = m?.[1] ?? '';
    }
    if (!YT_ID.test(id)) return null;
    return {
      provider: 'youtube',
      id,
      canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      // youtube-nocookie: no tracking cookies, which matters for a private vault
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`,
      aspect: 'video',
      label: 'YouTube',
    };
  }

  // ── TikTok ────────────────────────────────────────────────────────────────
  if (host === 'tiktok.com' || host === 'm.tiktok.com' || host === 'vm.tiktok.com') {
    // vm.tiktok.com short links resolve on TikTok's side; we only accept the
    // long form so the id is verifiable here.
    const m = url.pathname.match(/\/video\/(\d+)/);
    const id = m?.[1] ?? '';
    if (!TIKTOK_ID.test(id)) return null;
    return {
      provider: 'tiktok',
      id,
      canonicalUrl: `https://www.tiktok.com/@/video/${id}`,
      embedUrl: `https://www.tiktok.com/embed/v2/${id}`,
      aspect: 'square',
      label: 'TikTok',
    };
  }

  // ── Instagram Reels ───────────────────────────────────────────────────────
  if (host === 'instagram.com' || host === 'm.instagram.com') {
    const m = url.pathname.match(/^\/(?:reel|reels|p)\/([^/?#]+)/);
    const code = m?.[1] ?? '';
    if (!IG_CODE.test(code)) return null;
    return {
      provider: 'instagram',
      id: code,
      canonicalUrl: `https://www.instagram.com/reel/${code}/`,
      embedUrl: `https://www.instagram.com/reel/${code}/embed/captioned/`,
      aspect: 'square',
      label: 'Instagram',
    };
  }

  // ── Spotify (playlist_link contributions) ─────────────────────────────────
  if (host === 'open.spotify.com') {
    const m = url.pathname.match(/^\/(track|album|playlist|episode|show)\/([^/?#]+)/);
    const kind = m?.[1];
    const id = m?.[2] ?? '';
    if (!kind || !SPOTIFY_ID.test(id)) return null;
    return {
      provider: 'spotify',
      id,
      canonicalUrl: `https://open.spotify.com/${kind}/${id}`,
      embedUrl: `https://open.spotify.com/embed/${kind}/${id}?theme=0`,
      aspect: 'audio',
      label: 'Spotify',
    };
  }

  return null;
}

export function isVideoLinkAllowed(raw: string): boolean {
  const parsed = parseExternalLink(raw);
  return Boolean(parsed && parsed.provider !== 'spotify');
}

export const LINK_HELP_TEXT =
  'Paste a YouTube, TikTok or Instagram Reel link. Videos are embedded — they never use our storage.';

export const PLAYLIST_HELP_TEXT =
  'Paste an open.spotify.com link (track, album or playlist). It embeds a tiny player.';
