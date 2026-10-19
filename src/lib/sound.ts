'use client';

/**
 * UI sound effects — placeholders that are already wired up.
 *
 * The prompt asks for placeholder functions for crinkles and pops. These are
 * better than placeholders: they synthesise the sound with a few oscillators and
 * a noise buffer, so there is no audio file to download, no asset to license and
 * 0 bytes against the storage budget.
 *
 * Three rules:
 *   1. Nothing plays until the user has interacted with the page (`unlockAudio`).
 *   2. Everything is muted by default and respects `prefers-reduced-motion`.
 *   3. Every call is fire-and-forget and try/catch'd — sound must never be the
 *      reason a memory fails to save.
 */

let ctx: AudioContext | null = null;
let enabled = false;

const STORAGE_KEY = 'tiny-vault:sound';

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return enabled || window.localStorage.getItem(STORAGE_KEY) === 'on';
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    /* private mode — sound just will not persist */
  }
  if (next) void unlockAudio();
}

/** Must be called from a user gesture before any sound can play. */
export async function unlockAudio(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    ctx = null;
  }
}

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function ready(): AudioContext | null {
  if (!ctx || !enabled) return null;
  if (reducedMotion()) return null;
  return ctx;
}

/** Random paper-crinkle noise burst. Used when a slip is pinned or a page turns. */
export function playCrinkle(intensity = 0.5): void {
  const audio = ready();
  if (!audio) return;
  try {
    const duration = 0.18 + intensity * 0.16;
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * duration), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      // decaying noise = paper, not static
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2.4;
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;

    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400 + Math.random() * 1800;
    filter.Q.value = 0.7;

    const gain = audio.createGain();
    gain.gain.value = 0.05 + intensity * 0.06;

    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
    source.stop(audio.currentTime + duration);
  } catch {
    /* never throw from a sound */
  }
}

/** Short rounded "pop". Used for reactions and buttons. */
export function playPop(pitch = 1): void {
  const audio = ready();
  if (!audio) return;
  try {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    const now = audio.currentTime;
    osc.frequency.setValueAtTime(420 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(760 * pitch, now + 0.06);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch {
    /* noop */
  }
}

/** The seal tearing. Lower, longer, a bit rude. */
export function playPaperTear(): void {
  const audio = ready();
  if (!audio) return;
  try {
    const duration = 0.5;
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * duration), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * (1 - t) ** 1.4 * (0.4 + 0.6 * Math.sin(t * 40) ** 2);
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;
    const gain = audio.createGain();
    gain.gain.value = 0.12;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  } catch {
    /* noop */
  }
}

/** Soft two-note chime for "the capsule is open". */
export function playChime(): void {
  const audio = ready();
  if (!audio) return;
  try {
    const now = audio.currentTime;
    [523.25, 783.99].forEach((freq, index) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = now + index * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 1);
    });
  } catch {
    /* noop */
  }
}

/**
 * TODO (future): swap the synth for recorded foley once there is a place to put
 * it that is not our 1 GB budget. Candidates: a real crinkle, a wax-seal crack,
 * a jar lid. Would live in /public/sfx and be lazy-loaded on first interaction.
 */
export const SOUND_PLACEHOLDERS = ['crinkle', 'pop', 'paperTear', 'chime'] as const;
