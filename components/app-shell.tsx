"use client";

import { ChartColumnIcon, LibraryIcon, PlayIcon, PlusCircleIcon, SettingsIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { ConnectionBanners } from "@/components/connection-banners";
import { EntryOverlays } from "@/components/entry-overlays";
import { Logo } from "@/components/logo";
import { OverlayProvider } from "@/components/overlay-context";
import type { ConnectionInfo } from "@/lib/client-api";
import type { ServiceName } from "@/lib/mapping";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Accueil", icon: PlayIcon },
  { href: "/library", label: "Bibliothèque", icon: LibraryIcon },
  { href: "/stats", label: "Stats", icon: ChartColumnIcon },
  { href: "/add", label: "Ajouter", icon: PlusCircleIcon },
  { href: "/settings", label: "Paramètres", icon: SettingsIcon },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** "/" focuses the page search field (or opens the library search). */
function useGlobalShortcuts() {
  const router = useRouter();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      e.preventDefault();
      const input = document.querySelector<HTMLInputElement>("[data-search-input]");
      if (input) input.focus();
      else router.push("/library?focus=search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
}

export function AppShell({
  children,
  connections,
}: {
  children: React.ReactNode;
  connections: Record<ServiceName, ConnectionInfo | null>;
}) {
  const pathname = usePathname();
  useGlobalShortcuts();

  // Opening a booster takes the whole screen: no navigation to tap by accident mid-swipe.
  if (/^\/booster\/[^/]+/.test(pathname)) {
    return (
      <OverlayProvider>
        <div aria-hidden className="status-bar-scrim" />
        {children}
        <EntryOverlays />
      </OverlayProvider>
    );
  }

  return (
    <OverlayProvider>
      <div aria-hidden className="status-bar-scrim" />
      <div className="min-h-dvh lg:pl-64">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 border-r border-border bg-background/80 p-4 backdrop-blur lg:flex">
          <Link href="/" className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
            <span className="text-lg font-semibold tracking-tight">AniSync</span>
          </Link>
          <nav aria-label="Navigation principale" className="flex flex-col gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>
          <p className="mt-auto px-3 text-xs text-muted-foreground">
            Raccourcis : <kbd className="rounded border border-border px-1">/</kbd> recherche,{" "}
            <kbd className="rounded border border-border px-1">+</kbd> épisode suivant
          </p>
        </aside>

        <main className="mx-auto w-full max-w-[1600px] px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-6 lg:px-8 lg:pt-8 lg:pb-12">
          <ConnectionBanners connections={connections} />
          {children}
        </main>

        {/* Mobile / tablet bottom tab bar */}
        <nav
          aria-label="Navigation principale"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/85 pb-safe backdrop-blur-lg lg:hidden"
        >
          <ul className="mx-auto grid max-w-lg grid-cols-5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors outline-none focus-visible:bg-muted",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <Icon className={cn("size-[22px]", active && "text-primary")} aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <EntryOverlays />
    </OverlayProvider>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3 lg:mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
