"use client";

import { useQuery } from "@tanstack/react-query";
import { HistoryIcon, LoaderCircleIcon, SearchIcon, UserIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ResponsiveOverlay } from "@/components/responsive-overlay";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

interface ProfileHit {
  id: number;
  name: string;
  avatar: string | null;
}

/** AniList user names: letters, digits, "_" and "-". */
const NAME = /^[A-Za-z0-9_-]{1,30}$/;
const RECENT_KEY = "anisync.recentProfiles";
const RECENT_MAX = 6;

/** Recently analysed profiles, a per-browser convenience (may be empty or unavailable). */
function readRecent(): ProfileHit[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as ProfileHit[]).filter((p) => typeof p?.name === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberProfile(profile: ProfileHit): void {
  try {
    const next = [profile, ...readRecent().filter((p) => p.id !== profile.id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode…): no history, nothing else changes.
  }
}

function forgetProfile(id: number): ProfileHit[] {
  const next = readRecent().filter((p) => p.id !== id);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Same as above.
  }
  return next;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function ProfileAvatar({ src, className }: { src: string | null; className?: string }) {
  return (
    <span className={cn("relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted", className)}>
      {src ? <Image src={src} alt="" fill sizes="40px" className="object-cover" /> : <UserIcon aria-hidden className="size-4 text-muted-foreground" />}
    </span>
  );
}

function ProfileButton({ profile, onPick, children }: { profile: ProfileHit; onPick: (name: string) => void; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onPick(profile.name)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ProfileAvatar src={profile.avatar} />
        <span className="truncate text-sm font-medium">{profile.name}</span>
      </button>
      {children}
    </li>
  );
}

/** Find an AniList profile by name and open its stats. */
export function ProfileSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [recent, setRecent] = React.useState<ProfileHit[]>([]);
  const q = useDebounced(query.trim(), 300);
  const search = useQuery({
    queryKey: ["anilist-users", q.toLowerCase()],
    queryFn: () => api<{ users: ProfileHit[] }>(`/api/stats/users?q=${encodeURIComponent(q)}`),
    enabled: open && q.length >= 2,
    staleTime: 5 * 60_000,
  });

  React.useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);

  const pick = (name: string) => {
    onOpenChange(false);
    setQuery("");
    router.push(`/stats/u/${encodeURIComponent(name)}`);
  };

  const users = q.length >= 2 ? (search.data?.users ?? []) : [];

  return (
    <ResponsiveOverlay
      variant="dialog"
      open={open}
      onOpenChange={onOpenChange}
      title="Analyser un profil AniList"
      description="Toutes les stats, pour la liste publique de n'importe qui : un ami, par exemple."
    >
      <div className="flex flex-col gap-3 px-5 pt-3 pb-6 md:px-0 md:pb-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = query.trim();
            if (NAME.test(name)) pick(users.find((u) => u.name.toLowerCase() === name.toLowerCase())?.name ?? name);
          }}
          className="relative"
        >
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pseudo AniList"
            aria-label="Pseudo AniList"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="pr-10 pl-10"
          />
          {search.isFetching ? (
            <LoaderCircleIcon aria-hidden className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground motion-safe:animate-spin" />
          ) : null}
        </form>

        {q.length >= 2 ? (
          search.error ? (
            <p className="text-sm text-destructive">{search.error.message}</p>
          ) : users.length > 0 ? (
            <ul className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
              {users.map((u) => (
                <ProfileButton key={u.id} profile={u} onPick={pick} />
              ))}
            </ul>
          ) : search.isFetching ? null : (
            <p className="text-sm text-muted-foreground">Aucun profil trouvé. Entrée pour essayer « {query.trim()} » quand même.</p>
          )
        ) : recent.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HistoryIcon aria-hidden className="size-3.5" />
              Récents
            </p>
            <ul className="-mx-2 flex flex-col">
              {recent.map((p) => (
                <ProfileButton key={p.id} profile={p} onPick={pick}>
                  <button
                    type="button"
                    onClick={() => setRecent(forgetProfile(p.id))}
                    aria-label={`Retirer ${p.name} des récents`}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <XIcon className="size-4" />
                  </button>
                </ProfileButton>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">La liste du profil doit être publique sur AniList.</p>
        )}
      </div>
    </ResponsiveOverlay>
  );
}

