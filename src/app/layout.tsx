import type { Metadata, Viewport } from 'next';
import { Comic_Neue, Fredoka, Grand_Hotel } from 'next/font/google';
import './globals.css';
import { env } from '@/lib/env';

/**
 * Three faces, three jobs:
 *   Fredoka     — headings and numbers (rounded, friendly, very legible)
 *   Comic Neue  — body copy (handwritten but still a real text face)
 *   Grand Hotel — the script accent, used *only* for the wordmark
 *
 * next/font self-hosts these at build time, so there is no runtime request to
 * fonts.googleapis.com: faster, and no third-party cookie surface.
 */
const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fredoka',
  display: 'swap',
});

const comicNeue = Comic_Neue({
  subsets: ['latin'],
  weight: ['300', '400', '700'],
  variable: '--font-comic',
  display: 'swap',
});

const grandHotel = Grand_Hotel({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-grand',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: 'our tiny vault · a time capsule for us',
    template: '%s · our tiny vault',
  },
  description:
    'A cozy little place to bury notes, photos, voice memos and predictions for the people you love. Sealed until the day it matters.',
  openGraph: {
    title: 'our tiny vault',
    description: 'Seal a little piece of now for the people you love. Open it together, later.',
    type: 'website',
    url: env.siteUrl,
  },
  robots: { index: false, follow: false }, // private by default — it is a vault
  icons: {
    icon: [
      {
        url:
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#FCFBF7"/><text x="32" y="45" font-size="34" text-anchor="middle">🕰️</text></svg>',
          ),
        type: 'image/svg+xml',
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#FCFBF7',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fredoka.variable} ${comicNeue.variable} ${grandHotel.variable}`}
    >
      <body>
        {/* Shared SVG filters. Defined once, referenced by id from any card. */}
        <svg
          aria-hidden="true"
          width="0"
          height="0"
          className="pointer-events-none absolute"
          style={{ position: 'absolute', width: 0, height: 0 }}
        >
          <defs>
            {/* wobbles a straight line into a hand-drawn one */}
            <filter id="sketch" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="7" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <filter id="sketch-soft" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            {/* a soft pencil smudge used under stickers */}
            <filter id="pencil-shadow">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
          </defs>
        </svg>

        {children}
      </body>
    </html>
  );
}
