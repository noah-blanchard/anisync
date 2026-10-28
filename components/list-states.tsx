import Link from "next/link";
import { ENTRY_GRID, EntryCardSkeleton } from "@/components/entry-card";
import { Button } from "@/components/ui/button";

export function ListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={ENTRY_GRID} aria-busy="true" aria-label="Chargement">
      {Array.from({ length: count }, (_, i) => (
        <EntryCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description?: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-border px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {cta && (
        <Button asChild variant="secondary" className="mt-3">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  title = "Impossible de charger ta liste",
}: {
  message: string;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-3xl border border-border px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
