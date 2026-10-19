import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NewCapsuleForm } from '@/components/NewCapsuleForm';
import { getSessionProfile } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'new capsule' };

export default async function NewCapsulePage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/capsules/new');

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-10 sm:px-8">
      <Link href="/capsules" className="text-[12px] uppercase tracking-[0.16em] text-ink-faint">
        ← back to the shelf
      </Link>
      <h1 className="mt-3 font-script text-4xl text-cardboard-deep">a new capsule</h1>
      <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-soft">
        Three decisions: what it is called, when it opens, and who is allowed in. Everything else can
        stay a surprise.
      </p>

      <div className="mt-8">
        <NewCapsuleForm />
      </div>
    </main>
  );
}
