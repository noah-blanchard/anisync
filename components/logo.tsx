import { cn } from "@/lib/utils";

/** AniSync mark: two interlocking arcs (two services, one state). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8", className)}>
      <defs>
        <linearGradient id="anisync-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7cc8ff" />
          <stop offset="1" stopColor="#5b7cfa" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#12131a" />
      <path d="M18 38a14 14 0 0 1 24-14" fill="none" stroke="url(#anisync-a)" strokeWidth="6" strokeLinecap="round" />
      <path d="M46 26a14 14 0 0 1-24 14" fill="none" stroke="#e8ecff" strokeWidth="6" strokeLinecap="round" />
      <path d="M40 17l3 7.5-7.6 1.6" fill="none" stroke="url(#anisync-a)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 47l-3-7.5 7.6-1.6" fill="none" stroke="#e8ecff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
