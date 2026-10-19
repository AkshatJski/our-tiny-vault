'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { playCrinkle } from '@/lib/sound';

/**
 * A scratch-off card. Drag across it and the paper flakes away to reveal
 * whatever is underneath.
 *
 * Why a canvas and not a CSS mask: a mask gives you a fixed-hole punch, and the
 * fun of a scratch card is the *irregular* removal. `globalCompositeOperation =
 * 'destination-out'` gives real erasing, and the metadata layer is a single
 * `getImageData` sample at a throttled rate to decide when the card counts as
 * revealed (55% cleared).
 *
 * It is fully pointer-based (mouse, pen, touch) and does nothing when the user
 * prefers reduced motion — in that case the card starts revealed.
 */
export function ScratchOffResolution({
  children,
  onRevealed,
  className,
  label = 'scratch to reveal',
  autoRevealOnMount = false,
}: {
  children: React.ReactNode;
  onRevealed?: () => void;
  className?: string;
  label?: string;
  autoRevealOnMount?: boolean;
}) {
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastSampleRef = useRef(0);
  const [revealed, setRevealed] = useState(false);

  const paint = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Foil-ish paper: warm base + speckle, so it looks like a real card.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#E3C9A9';
    ctx.fillRect(0, 0, rect.width, rect.height);

    for (let i = 0; i < 340; i += 1) {
      const x = Math.random() * rect.width;
      const y = Math.random() * rect.height;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,.5)' : 'rgba(140,98,57,.22)';
      ctx.fillRect(x, y, 2, 2);
    }

    ctx.fillStyle = 'rgba(74,63,53,.55)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label.toUpperCase(), rect.width / 2, rect.height / 2 + 4);
  }, [label]);

  useEffect(() => {
    if (reduce || autoRevealOnMount) {
      setRevealed(true);
      onRevealed?.();
      return;
    }
    paint();
    const observer = new ResizeObserver(() => {
      if (!drawingRef.current) paint();
    });
    if (wrapRef.current) observer.observe(wrapRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, reduce, autoRevealOnMount]);

  const eraseAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const x = (clientX - rect.left) * dpr;
    const y = (clientY - rect.top) * dpr;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 22 * dpr, 0, Math.PI * 2);
    ctx.fill();

    evaluate(rect.width, rect.height);
  };

  const evaluate = (width: number, height: number) => {
    const now = Date.now();
    if (now - lastSampleRef.current < 140) return;
    lastSampleRef.current = now;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0) return;

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let clear = 0;
    let total = 0;
    // Sample every 16th pixel (4 bytes each) — enough signal, cheap enough to
    // run on every drag without dropping frames on a phone.
    for (let i = 3; i < data.length; i += 64) {
      total += 1;
      if (data[i] < 24) clear += 1;
    }
    const fraction = total > 0 ? clear / total : 0;

    if (fraction > 0.55) {
      setRevealed(true);
      playCrinkle(0.5);
      onRevealed?.();
    }
    void width;
    void height;
  };

  return (
    <div ref={wrapRef} className={cn('scratch-canvas relative select-none overflow-hidden rounded-xl', className)}>
      {children}

      <AnimatePresence>
        {!revealed ? (
          <motion.canvas
            key="foil"
            ref={canvasRef}
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="absolute inset-0 h-full w-full touch-none"
            onPointerDown={(event) => {
              drawingRef.current = true;
              (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
              eraseAt(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
              if (!drawingRef.current) return;
              eraseAt(event.clientX, event.clientY);
            }}
            onPointerUp={() => {
              drawingRef.current = false;
            }}
            onPointerCancel={() => {
              drawingRef.current = false;
            }}
            onPointerLeave={() => {
              drawingRef.current = false;
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
