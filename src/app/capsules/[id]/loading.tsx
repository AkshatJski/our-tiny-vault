export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-8 sm:px-8">
      <div className="h-4 w-24 rounded-full bg-cream-200/70" />
      <div className="mt-4 h-56 w-full rounded-3xl border border-cream-300 bg-cream-50 shadow-paper" />
      <div className="mt-10 h-6 w-32 rounded-full bg-cream-200/70" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 rounded-2xl border border-cream-300 bg-cream-50 shadow-paper" />
        ))}
      </div>
    </main>
  );
}
