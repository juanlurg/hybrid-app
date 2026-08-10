/**
 * Suspense boundary for every app screen. Its existence is what makes
 * navigation feel instant: without a loading file, a dynamic route is
 * never prefetched and the old screen stays frozen until the server
 * finishes rendering the new one.
 */
export default function Loading() {
  return (
    <div className="flex min-h-0 flex-1 animate-pulse flex-col" aria-busy>
      <div className="flex-none px-5 pt-6 pb-4">
        <div className="h-2.5 w-24 rounded-sm bg-soft" />
        <div className="mt-3 h-7 w-44 rounded-sm bg-soft" />
      </div>
      <div className="flex flex-col gap-1.5 px-5">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3"
          >
            <div className="h-8 w-[3px] flex-none rounded-full bg-soft" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-32 rounded-sm bg-soft" />
              <div className="mt-2 h-2.5 w-48 rounded-sm bg-soft" />
            </div>
            <div className="h-3 w-10 flex-none rounded-sm bg-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
