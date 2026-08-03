/**
 * Suspense boundary for every app screen. Its existence is what makes
 * navigation feel instant: without a loading file, a dynamic route is
 * never prefetched and the old screen stays frozen until the server
 * finishes rendering the new one.
 */
export default function Loading() {
  return (
    <div className="flex min-h-0 flex-1 animate-pulse flex-col" aria-busy>
      <div className="flex-none bg-ink px-4 pt-5 pb-4">
        <div className="h-2.5 w-24 bg-ink-2" />
        <div className="mt-3 h-7 w-44 bg-ink-2" />
      </div>
      <div className="flex flex-col gap-px bg-line">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-2.5 bg-paper px-4 py-3">
            <div className="h-9 w-1.5 flex-none bg-soft" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-32 bg-soft" />
              <div className="mt-2 h-2.5 w-48 bg-soft" />
            </div>
            <div className="h-3 w-10 flex-none bg-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
