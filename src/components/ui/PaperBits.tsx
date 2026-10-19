import { cn } from '@/lib/utils';

/**
 * A genuinely hand-drawn looking border.
 *
 * Why an overlay instead of `filter: url(#sketch)` on the card itself:
 * the displacement filter would also wobble the text inside, which reads as
 * "broken screen" rather than "drawn with a pen". Applying it to a transparent
 * SVG rect that sits on top gives the wobbly edge and leaves the content crisp.
 *
 * Cost: one absolutely-positioned SVG per card. Cheap, and it is pure CSS/SVG —
 * no JS, no animation frame.
 */
export function SketchyFrame({
  radius = 18,
  dashed = false,
  stroke = 'rgba(74,63,53,0.34)',
  soft = false,
  className,
}: {
  radius?: number;
  dashed?: boolean;
  stroke?: string;
  soft?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
      preserveAspectRatio="none"
    >
      <rect
        x="1.5"
        y="1.5"
        width="calc(100% - 3px)"
        height="calc(100% - 3px)"
        rx={radius}
        ry={radius}
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        strokeDasharray={dashed ? '7 5' : undefined}
        strokeLinecap="round"
        style={{ filter: `url(#${soft ? 'sketch-soft' : 'sketch'})` }}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A torn strip of washi tape. Purely decorative. */
export function WashiTape({
  className,
  rotate = -4,
  width = 92,
}: {
  className?: string;
  rotate?: number;
  width?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('washi pointer-events-none absolute block h-6 rounded-[2px]', className)}
      style={{ width, transform: `rotate(${rotate}deg)` }}
    />
  );
}

/** The little brass pin that holds a prediction slip to the cork. */
export function PinDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute block h-4 w-4 rounded-full', className)}
      style={{
        background: 'radial-gradient(circle at 34% 30%, #FBE3E1 0%, #D98C86 42%, #A85F5A 100%)',
        boxShadow: '0 2px 3px rgba(74,63,53,.45), inset 0 -1px 1px rgba(0,0,0,.18)',
      }}
    />
  );
}

/** Folded corner, the cheap trick that makes a rectangle feel like paper. */
export function CornerFold({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute bottom-0 right-0 block h-6 w-6', className)}
      style={{
        background: 'linear-gradient(135deg, transparent 50%, rgba(74,63,53,.13) 50%, #EBE4D4 52%)',
        borderTopLeftRadius: 6,
      }}
    />
  );
}

/** A stamp-like pill. Used for "SEALED", counts, and status. */
export function Stamp({
  children,
  tone = 'ink',
  className,
}: {
  children: React.ReactNode;
  tone?: 'ink' | 'blush' | 'sage' | 'butter' | 'cardboard';
  className?: string;
}) {
  const tones: Record<string, string> = {
    ink: 'border-ink-faint/60 text-ink-soft',
    blush: 'border-blush-deep/60 text-blush-deep',
    sage: 'border-sage-deep/60 text-sage-deep',
    butter: 'border-butter-deep/70 text-cardboard-deep',
    cardboard: 'border-cardboard-deep/60 text-cardboard-deep',
  };
  return <span className={cn('stamp', tones[tone], className)}>{children}</span>;
}

/** Hand-drawn horizontal rule with a dot in the middle. */
export function DotDivider({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex items-center gap-3', className)}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-ink/20 to-transparent" />
      <span className="h-1.5 w-1.5 rounded-full bg-ink/25" />
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-ink/20 to-transparent" />
    </div>
  );
}
