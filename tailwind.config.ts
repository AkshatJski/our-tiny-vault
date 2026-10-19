import type { Config } from 'tailwindcss';

/**
 * "our tiny vault" design tokens.
 *
 * The palette is deliberately small and warm. Every colour below maps to a CSS
 * variable in globals.css so the paper-grain overlays can reuse them and so a
 * future "night reading" theme only has to swap variables, not classes.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: '#FCFBF7',
          50: '#FFFEFB',
          100: '#FCFBF7',
          200: '#F5F1E6',
          300: '#EBE4D4',
        },
        blush: {
          DEFAULT: '#F4C7C3',
          light: '#FBE3E1',
          deep: '#D98C86',
        },
        butter: {
          DEFAULT: '#F7E3A1',
          light: '#FCF3CE',
          deep: '#D9B94F',
        },
        sage: {
          DEFAULT: '#B9CDB4',
          light: '#DCE8D8',
          deep: '#7E9B78',
        },
        cardboard: {
          DEFAULT: '#C89F73',
          light: '#E3C9A9',
          deep: '#8C6239',
        },
        ink: {
          DEFAULT: '#4A3F35',
          soft: '#6E6154',
          faint: '#9C9186',
        },
      },
      fontFamily: {
        // next/font injects these variables in layout.tsx
        round: ['var(--font-fredoka)', 'Fredoka', 'system-ui', 'sans-serif'],
        sketch: ['var(--font-comic)', 'Comic Neue', 'Comic Sans MS', 'cursive'],
        script: ['var(--font-grand)', 'Grand Hotel', 'cursive'],
      },
      boxShadow: {
        paper: '0 1px 2px rgba(74,63,53,.06), 0 8px 20px -8px rgba(74,63,53,.22)',
        'paper-lift': '0 2px 4px rgba(74,63,53,.08), 0 18px 40px -12px rgba(74,63,53,.3)',
        'paper-inset': 'inset 0 1px 0 rgba(255,255,255,.7), inset 0 -1px 0 rgba(74,63,53,.06)',
        tag: '0 6px 14px -6px rgba(140,98,57,.5)',
      },
      backgroundImage: {
        grain:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.055'/%3E%3C/svg%3E\")",
        dots:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18'%3E%3Ccircle cx='2' cy='2' r='1.05' fill='%234A3F35' opacity='.16'/%3E%3C/svg%3E\")",
        // cork pinboard: layered radial dots over warm brown
        cork:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Ccircle cx='5' cy='5' r='2.1' fill='%238C6239' opacity='.3'/%3E%3Ccircle cx='16' cy='15' r='1.5' fill='%238C6239' opacity='.22'/%3E%3Ccircle cx='22' cy='6' r='1.2' fill='%236B4A2A' opacity='.2'/%3E%3C/svg%3E\")",
        ruled:
          'repeating-linear-gradient(to bottom, transparent 0 27px, rgba(74,63,53,.14) 27px 28px)',
      },
      keyframes: {
        wiggle: {
          '0%,100%': { transform: 'rotate(-1.1deg)' },
          '50%': { transform: 'rotate(1.1deg)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0) rotate(-2deg)' },
          '50%': { transform: 'translateY(-9px) rotate(2deg)' },
        },
        'peel-in': {
          '0%': { transform: 'rotate(-3deg) translateY(10px) scale(.96)', opacity: '0' },
          '60%': { transform: 'rotate(1deg) translateY(-2px) scale(1.01)', opacity: '1' },
          '100%': { transform: 'rotate(0) translateY(0) scale(1)', opacity: '1' },
        },
        rise: {
          '0%': { transform: 'translateY(0) scale(.6)', opacity: '0' },
          '20%': { opacity: '1' },
          '100%': { transform: 'translateY(-220px) scale(1.25) rotate(12deg)', opacity: '0' },
        },
        breathe: {
          '0%,100%': { opacity: '.55', transform: 'scale(1)' },
          '50%': { opacity: '.9', transform: 'scale(1.04)' },
        },
        'seal-shake': {
          '0%,100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-2px) rotate(-1deg)' },
          '75%': { transform: 'translateX(2px) rotate(1deg)' },
        },
      },
      animation: {
        wiggle: 'wiggle 3.2s ease-in-out infinite',
        float: 'float 4.6s ease-in-out infinite',
        'peel-in': 'peel-in .5s cubic-bezier(.34,1.56,.64,1) both',
        rise: 'rise 2.4s ease-out forwards',
        breathe: 'breathe 3.4s ease-in-out infinite',
        'seal-shake': 'seal-shake .35s ease-in-out 3',
      },
      transitionTimingFunction: {
        bouncy: 'cubic-bezier(.34,1.56,.64,1)',
      },
    },
  },
  plugins: [],
};

export default config;
