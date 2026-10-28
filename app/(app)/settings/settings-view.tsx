"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { InstallButton, usePwa } from "@/components/pwa";
import { useTheme, type ThemePreference } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useBoosterAdult } from "@/hooks/use-booster";
import { LIST_KEY } from "@/hooks/use-list";
import { api, type ConnectionInfo } from "@/lib/client-api";
import { daysUntil, formatDate } from "@/lib/labels";
import type { ServiceName } from "@/lib/mapping";
import { cn } from "@/lib/utils";

const SERVICES: { id: ServiceName; name: string; site: string }[] = [
  { id: "mal", name: "MyAnimeList", site: "https://myanimelist.net/apiconfig" },
  { id: "anilist", name: "AniList", site: "https://anilist.co/settings/developer" },
];

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * In an installed iOS app, OAuth providers open in a Safari sheet that does not share the app cookies:
 * open the flow in Safari explicitly (tokens are stored server-side, so the app sees the result).
 */
function ConnectLink({ service, children, ...props }: React.ComponentProps<"a"> & { service: ServiceName }) {
  const { standalone, platform } = usePwa();
  const external = standalone && platform === "ios";
  return (
    <a
      href={`/api/auth/${service}/connect`}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      {...props}
    >
      {children}
    </a>
  );
}

function ConnectionCard({ service, info }: { service: (typeof SERVICES)[number]; info: ConnectionInfo | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [pending, setPending] = React.useState(false);
  const [now] = React.useState(() => Date.now());
  const days = info ? daysUntil(info.expiresAt, now) : null;

  // MAL tokens refresh automatically: only AniList expiry needs attention.
  const status = !info
    ? { label: "Non connecté", variant: "secondary" as const }
    : service.id === "anilist" && days !== null && days <= 0
      ? { label: "Expiré", variant: "warning" as const }
      : service.id === "anilist" && days !== null && days <= 14
        ? { label: "Expire bientôt", variant: "warning" as const }
        : { label: "Connecté", variant: "success" as const };

  const disconnect = async () => {
    setPending(true);
    try {
      await api(`/api/auth/${service.id}`, { method: "DELETE" });
      toast.success(`${service.name} déconnecté`);
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      router.refresh();
    } catch (error) {
      toast.error(`Déconnexion impossible : ${(error as Error).message}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-full bg-muted">
          {info?.avatarUrl && <Image src={info.avatarUrl} alt="" fill sizes="48px" className="object-cover" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{service.name}</span>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {info
              ? `${info.username} · ${service.id === "mal" ? "renouvelé automatiquement" : `jeton valable jusqu'au ${formatDate(info.expiresAt)}`}`
              : "Connecte ton compte pour synchroniser ce service."}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {info ? (
          <>
            <Button variant="outline" asChild>
              <ConnectLink service={service.id}>Reconnecter</ConnectLink>
            </Button>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={disconnect} disabled={pending}>
              Déconnecter
            </Button>
          </>
        ) : (
          <Button asChild>
            <ConnectLink service={service.id}>Connecter</ConnectLink>
          </Button>
        )}
      </div>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copié");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible, sélectionne le texte manuellement");
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-sm select-all">{value}</code>
        <Button variant="ghost" size="icon" onClick={copy} aria-label={`Copier l'URI ${label}`}>
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}

const THEMES: { id: ThemePreference; label: string; icon: LucideIcon }[] = [
  { id: "dark", label: "Sombre", icon: MoonIcon },
  { id: "light", label: "Clair", icon: SunIcon },
  { id: "system", label: "Système", icon: MonitorIcon },
];

function AppSection({ appUrl, qrSvg }: { appUrl: string; qrSvg: string }) {
  const { standalone } = usePwa();
  return (
    <Section
      title="Application"
      description="Installe AniSync sur ton téléphone pour l'ouvrir comme une app, en plein écran."
    >
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <InstallButton />
          {!standalone && (
            <p className="hidden text-sm text-muted-foreground md:block">
              Scanne ce QR code avec l&apos;appareil photo de ton téléphone pour ouvrir{" "}
              <span className="font-mono text-foreground">{appUrl.replace(/^https?:\/\//, "")}</span>, puis installe
              l&apos;app depuis là.
            </p>
          )}
        </div>
        {!standalone && (
          <div
            role="img"
            aria-label={`QR code vers ${appUrl}`}
            className="hidden size-36 shrink-0 overflow-hidden rounded-xl bg-white p-1 md:block [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        )}
      </div>
    </Section>
  );
}

function BoosterSection() {
  const [adult, setAdult] = useBoosterAdult();
  return (
    <Section title="Boosters">
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4">
        <div className="min-w-0">
          <Label htmlFor="booster-adult" className="leading-snug">
            Contenu adulte
          </Label>
          <p id="booster-adult-description" className="mt-1 text-sm text-muted-foreground">
            Inclut les animes ecchi et +18 dans les boosters. Réglage propre à cet appareil.
          </p>
        </div>
        <Switch
          id="booster-adult"
          checked={adult}
          onCheckedChange={setAdult}
          aria-describedby="booster-adult-description"
        />
      </div>
    </Section>
  );
}

export function SettingsView({
  connections,
  redirectUris,
  appUrl,
  qrSvg,
  version,
}: {
  connections: Record<ServiceName, ConnectionInfo | null>;
  redirectUris: Record<ServiceName, string>;
  appUrl: string;
  qrSvg: string;
  version: string;
}) {
  const { theme, setTheme } = useTheme();
  const { standalone, platform } = usePwa();
  const iosApp = standalone && platform === "ios";
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Feedback after an OAuth round-trip, then clean the URL.
  React.useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    const name = (s: string | null) => SERVICES.find((x) => x.id === s)?.name ?? "Service";
    if (connected) toast.success(`${name(connected)} connecté`);
    if (error) toast.error(`Connexion ${name(error)} impossible : ${params.get("reason") ?? "erreur inconnue"}`, { duration: 12_000 });
    router.replace(pathname);
  }, [params, router, pathname]);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  };

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <PageHeader title="Paramètres" />

      <Section title="Comptes" description="Les jetons sont chiffrés sur ton serveur et ne quittent jamais le backend.">
        {SERVICES.map((service) => (
          <ConnectionCard key={service.id} service={service} info={connections[service.id]} />
        ))}
        {iosApp && (
          <p className="text-sm text-muted-foreground">
            Dans l&apos;app installée sur iPhone, la connexion s&apos;ouvre dans Safari. Une fois terminée, reviens ici et
            tire vers le bas pour actualiser.
          </p>
        )}
      </Section>

      <AppSection appUrl={appUrl} qrSvg={qrSvg} />

      <Section
        title="Redirect URIs"
        description="À renseigner dans la configuration de tes applications OAuth MyAnimeList et AniList."
      >
        <CopyField label="MyAnimeList" value={redirectUris.mal} />
        <CopyField label="AniList" value={redirectUris.anilist} />
      </Section>

      <Section title="Apparence">
        <div role="radiogroup" aria-label="Thème" className="grid grid-cols-3 gap-2 sm:max-w-md">
          {THEMES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              onClick={() => setTheme(id)}
              className={cn(
                "flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                theme === id
                  ? "border-transparent bg-primary/15 text-foreground ring-1 ring-primary/50"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </Section>

      <BoosterSection />

      <Section title="Session">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={logout}>
            <LogOutIcon />
            Se déconnecter
          </Button>
          <Link
            href="/changelog"
            className="text-sm text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline"
          >
            AniSync v{version} · Nouveautés
          </Link>
        </div>
      </Section>
    </div>
  );
}
