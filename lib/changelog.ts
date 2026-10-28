export type ChangelogRelease = {
  version: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  title: string;
  changes: string[];
};

/** Newest first. Add an entry (and bump package.json) with each user-facing change. */
export const CHANGELOG: ChangelogRelease[] = [
  {
    version: "1.3.0",
    date: "2026-10-28",
    title: "Boosters",
    changes: [
      "Ouvre des boosters depuis l'accueil : déchire le paquet, découvre 5 animes et ajoute-les à ta liste d'un glissement.",
      "Raretés Commune, Rare, Épique et Pépite, la perle méconnue la mieux notée, toujours révélée en dernier.",
      "Les animes déjà dans ta liste ou passés récemment ne reviennent pas, et tu peux annuler ton dernier choix.",
      "Option « Contenu adulte » dans les paramètres pour inclure l'ecchi et le +18 dans les boosters.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-28",
    title: "Comme une vraie app",
    changes: [
      "Le zoom est désactivé dans l'app installée (pincement et double tap).",
      "Nouvelle page Nouveautés pour suivre l'évolution d'AniSync.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-27",
    title: "Installable sur téléphone",
    changes: [
      "AniSync s'installe sur l'écran d'accueil, avec icônes et écrans de démarrage iOS.",
      "Page hors ligne quand le réseau ne répond pas.",
      "Invitation à installer l'app, guide pas à pas pour iPhone et QR code pour l'ouvrir sur mobile.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-27",
    title: "Première version",
    changes: [
      "Synchronisation de ta liste entre MyAnimeList et AniList, en un geste.",
      "Accueil, bibliothèque, ajout d'animes et paramètres.",
      "Comparaison des deux listes et synchronisation en masse des écarts.",
      "Thème clair, sombre ou automatique.",
    ],
  },
];
