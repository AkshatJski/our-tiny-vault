import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { getSessionProfile } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'sign in' };

/**
 * Server shell around a client form.
 *
 * The split exists for one practical reason: `useSearchParams()` in a client page
 * forces a Suspense boundary at build time. Doing it here, once, keeps the build
 * output quiet and the form itself a plain client component.
 */
export default async function LoginPage() {
  if (env.isSupabaseConfigured) {
    const profile = await getSessionProfile();
    if (profile) redirect('/capsules');
  }

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-14">
      <Suspense
        fallback={
          <div className="grid h-72 w-full max-w-md animate-pulse place-items-center rounded-3xl border border-cream-300 bg-cream-50 text-sm text-ink-faint">
            warming up…
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
