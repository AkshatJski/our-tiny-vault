import Link from 'next/link';
import { BouncyButton } from '@/components/ui/BouncyButton';
import { SketchyFrame } from '@/components/ui/PaperBits';

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center px-5">
      <div className="relative w-full rounded-3xl border border-cream-300 bg-cream-50 p-9 text-center shadow-paper">
        <SketchyFrame radius={22} soft stroke="rgba(74,63,53,.2)" />
        <span className="text-4xl">🫙</span>
        <h1 className="mt-3 font-round text-2xl font-bold text-ink">Nothing in this drawer</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          The capsule either does not exist, or you are not a member of it — and we will not tell you
          which, because that is somebody else&apos;s business.
        </p>
        <Link href="/capsules" className="mt-6 inline-block">
          <BouncyButton tone="blush">your capsules</BouncyButton>
        </Link>
      </div>
    </main>
  );
}
