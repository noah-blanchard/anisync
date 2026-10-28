import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AniSync",
    short_name: "AniSync",
    description: "Tes animes à jour sur MyAnimeList et AniList, en un geste.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#0b0c10",
    theme_color: "#0b0c10",
    categories: ["entertainment", "lifestyle", "utilities"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
    ],
    shortcuts: [
      {
        name: "En cours",
        short_name: "En cours",
        description: "Les animes que tu regardes",
        url: "/",
        icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Ajouter un anime",
        short_name: "Ajouter",
        description: "Rechercher et ajouter un anime",
        url: "/add",
        icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Bibliothèque",
        short_name: "Bibliothèque",
        description: "Toute ta liste",
        url: "/library",
        icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
      },
    ],
  };
}
