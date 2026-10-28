"use client";

import { CheckCircle2Icon, DownloadIcon, EllipsisVerticalIcon, PlusSquareIcon, ShareIcon, SmartphoneIcon, XIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { ResponsiveOverlay } from "@/components/responsive-overlay";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "desktop";

interface PwaContextValue {
  /** Running as an installed app (home screen / desktop window) */
  standalone: boolean;
  platform: Platform;
  /** The browser offered a native install prompt (Chrome, Edge, Samsung Internet) */
  canPrompt: boolean;
  /** Opens the native prompt, or the step-by-step guide when there is none */
  install: () => Promise<void>;
}

const PwaContext = React.createContext<PwaContextValue | null>(null);

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac: tell them apart with touch support.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

function detectStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [standalone, setStandalone] = React.useState(false);
  const [platform, setPlatform] = React.useState<Platform>("desktop");
  const [promptEvent, setPromptEvent] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [guideOpen, setGuideOpen] = React.useState(false);

  React.useEffect(() => {
    setPlatform(detectPlatform());
    setStandalone(detectStandalone());
    document.documentElement.toggleAttribute("data-standalone", detectStandalone());

    const media = window.matchMedia("(display-mode: standalone)");
    const onDisplayChange = () => setStandalone(detectStandalone());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      toast.success("AniSync est installée sur ton appareil");
    };
    media.addEventListener("change", onDisplayChange);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Not fatal: the app works without it, only install/offline polish is lost.
      });
    }

    return () => {
      media.removeEventListener("change", onDisplayChange);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = React.useCallback(async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === "accepted") setPromptEvent(null);
      return;
    }
    setGuideOpen(true);
  }, [promptEvent]);

  const value = React.useMemo(
    () => ({ standalone, platform, canPrompt: promptEvent !== null, install }),
    [standalone, platform, promptEvent, install],
  );

  return (
    <PwaContext.Provider value={value}>
      {children}
      <InstallGuide open={guideOpen} onOpenChange={setGuideOpen} platform={platform} />
    </PwaContext.Provider>
  );
}

export function usePwa(): PwaContextValue {
  const ctx = React.useContext(PwaContext);
  if (!ctx) throw new Error("usePwa doit être utilisé dans <PwaProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Install guide (iOS has no install prompt, so walk through the share sheet)
// ---------------------------------------------------------------------------

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary tabular-nums">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug">{children}</span>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground" aria-hidden>
        {icon}
      </span>
    </li>
  );
}

function InstallGuide({
  open,
  onOpenChange,
  platform,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: Platform;
}) {
  return (
    <ResponsiveOverlay
      variant="dialog"
      open={open}
      onOpenChange={onOpenChange}
      title="Installer AniSync"
      description="Ajoute l'app à ton écran d'accueil pour l'ouvrir comme une vraie application."
    >
      <div className="flex flex-col gap-4 p-5 pt-2 md:p-0">
        <div className="flex items-center gap-3">
          <Logo className="size-12" />
          <div className="text-sm text-muted-foreground">Plein écran, icône sur l&apos;écran d&apos;accueil, ouverture instantanée.</div>
        </div>
        {platform === "ios" ? (
          <ol className="flex flex-col gap-2">
            <Step n={1} icon={<ShareIcon className="size-4" />}>
              Dans Safari, touche le bouton <strong>Partager</strong> (ou <strong>•••</strong> puis Partager).
            </Step>
            <Step n={2} icon={<PlusSquareIcon className="size-4" />}>
              Choisis <strong>Sur l&apos;écran d&apos;accueil</strong> (fais défiler la liste si besoin).
            </Step>
            <Step n={3} icon={<CheckCircle2Icon className="size-4" />}>
              Laisse <strong>Ouvrir en tant qu&apos;app web</strong> activé, puis touche <strong>Ajouter</strong>.
            </Step>
          </ol>
        ) : platform === "android" ? (
          <ol className="flex flex-col gap-2">
            <Step n={1} icon={<EllipsisVerticalIcon className="size-4" />}>
              Ouvre le menu <strong>⋮</strong> de ton navigateur.
            </Step>
            <Step n={2} icon={<DownloadIcon className="size-4" />}>
              Touche <strong>Installer l&apos;application</strong> ou <strong>Ajouter à l&apos;écran d&apos;accueil</strong>.
            </Step>
          </ol>
        ) : (
          <ol className="flex flex-col gap-2">
            <Step n={1} icon={<DownloadIcon className="size-4" />}>
              Dans Chrome ou Edge, clique sur l&apos;icône <strong>Installer</strong> dans la barre d&apos;adresse.
            </Step>
            <Step n={2} icon={<SmartphoneIcon className="size-4" />}>
              Sur ton téléphone : scanne le QR code dans <strong>Paramètres</strong> pour ouvrir AniSync directement.
            </Step>
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          {platform === "ios"
            ? "Sur iPhone, l'installation se fait depuis Safari. Tu devras te reconnecter une fois dans l'app installée."
            : "Tu devras peut-être te reconnecter une fois dans l'app installée."}
        </p>
      </div>
    </ResponsiveOverlay>
  );
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const DISMISS_KEY = "anisync-install-dismissed";

/** Dismissible invitation on the home screen of a phone browser. */
export function InstallCard() {
  const { standalone, platform, install } = usePwa();
  const [dismissed, setDismissed] = React.useState(true);

  React.useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (standalone || dismissed || platform === "desktop") return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore: the card simply comes back next visit
    }
  };

  return (
    <div className="relative mb-5 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card to-card p-4">
      <div aria-hidden className="absolute -top-10 -right-10 size-32 rounded-full bg-primary/20 blur-2xl" />
      <div className="relative flex items-center gap-3.5">
        <Logo className="size-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Installe AniSync</p>
          <p className="text-sm text-muted-foreground">Sur ton écran d&apos;accueil, en plein écran, à portée de pouce.</p>
        </div>
        <Button variant="ghost" size="icon" className="-mt-6 -mr-2 size-9 self-start" onClick={dismiss} aria-label="Masquer">
          <XIcon />
        </Button>
      </div>
      <Button className="relative mt-3.5 w-full" onClick={install}>
        <DownloadIcon />
        Installer l&apos;app
      </Button>
    </div>
  );
}

/** Settings block: install button or "already installed" state. */
export function InstallButton() {
  const { standalone, install } = usePwa();
  if (standalone) {
    return (
      <p className="flex items-center gap-2 text-sm text-success">
        <CheckCircle2Icon className="size-4" aria-hidden />
        Tu utilises l&apos;app installée.
      </p>
    );
  }
  return (
    <Button onClick={install} className="w-fit">
      <DownloadIcon />
      Installer l&apos;app
    </Button>
  );
}
