"use client";

import { AlertTriangleIcon, LinkIcon, XIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useList } from "@/hooks/use-list";
import type { ConnectionInfo } from "@/lib/client-api";
import { daysUntil, SERVICE_LABELS } from "@/lib/labels";
import type { ServiceName } from "@/lib/mapping";
import { cn } from "@/lib/utils";

const ANILIST_WARNING_DAYS = 14;

function Banner({
  tone,
  children,
  action,
  onDismiss,
}: {
  tone: "info" | "warning";
  children: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      className={cn(
        "mb-3 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
        tone === "warning" ? "border-warning/30 bg-warning/10" : "border-border bg-card",
      )}
    >
      {tone === "warning" ? (
        <AlertTriangleIcon className="size-4 shrink-0 text-warning" aria-hidden />
      ) : (
        <LinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <p className="min-w-0 flex-1">{children}</p>
      {action}
      {onDismiss && (
        <Button variant="ghost" size="icon" className="-mr-2 size-9" onClick={onDismiss} aria-label="Masquer">
          <XIcon />
        </Button>
      )}
    </div>
  );
}

/** Non-blocking banners: service not connected, AniList token expiring, list load errors. */
export function ConnectionBanners({ connections }: { connections: Record<ServiceName, ConnectionInfo | null> }) {
  const { data } = useList();
  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const [now] = React.useState(() => Date.now());
  const current = data?.connections ?? connections;
  const dismiss = (id: string) => setDismissed((d) => [...d, id]);
  const banners: React.ReactNode[] = [];

  for (const service of ["mal", "anilist"] as const) {
    if (!current[service] && !dismissed.includes(`connect-${service}`)) {
      banners.push(
        <Banner
          key={`connect-${service}`}
          tone="info"
          onDismiss={() => dismiss(`connect-${service}`)}
          action={
            <Button size="sm" variant="secondary" asChild>
              <a href={`/api/auth/${service}/connect`}>Connecter</a>
            </Button>
          }
        >
          {SERVICE_LABELS[service]} n&apos;est pas connecté : les modifications ne seront faites que sur l&apos;autre service.
        </Banner>,
      );
    }
  }

  const anilist = current.anilist;
  if (anilist) {
    const days = daysUntil(anilist.expiresAt, now);
    if (days <= ANILIST_WARNING_DAYS && !dismissed.includes("anilist-expiry")) {
      banners.push(
        <Banner
          key="anilist-expiry"
          tone="warning"
          onDismiss={() => dismiss("anilist-expiry")}
          action={
            <Button size="sm" asChild>
              <a href="/api/auth/anilist/connect">Reconnecter</a>
            </Button>
          }
        >
          {days > 0
            ? `Ton jeton AniList expire dans ${days} jour${days > 1 ? "s" : ""}.`
            : "Ton jeton AniList a expiré."}
        </Banner>,
      );
    }
  }

  for (const service of ["mal", "anilist"] as const) {
    const error = data?.errors[service];
    if (error && !dismissed.includes(`error-${service}`)) {
      banners.push(
        <Banner
          key={`error-${service}`}
          tone="warning"
          onDismiss={() => dismiss(`error-${service}`)}
          action={
            <Button size="sm" variant="secondary" asChild>
              <Link href="/settings">Paramètres</Link>
            </Button>
          }
        >
          Impossible de charger la liste {SERVICE_LABELS[service]} : {error}
        </Banner>,
      );
    }
  }

  if (banners.length === 0) return null;
  return <div className="mb-2">{banners}</div>;
}
