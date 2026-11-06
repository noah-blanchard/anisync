/** Trimmed but realistic TMDB responses (language=fr-FR). */

export const tvSearch = {
  page: 1,
  results: [
    {
      id: 1396,
      name: "Breaking Bad",
      original_name: "Breaking Bad",
      poster_path: "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
      first_air_date: "2008-01-20",
      overview: "Un professeur de chimie atteint d'un cancer se lance dans la fabrication de méthamphétamine.",
    },
    {
      id: 60625,
      name: "Rick et Morty",
      original_name: "Rick and Morty",
      poster_path: null,
      first_air_date: "",
      overview: "",
    },
    { id: "oops", name: "Broken row" },
    { id: 5, poster_path: "/x.jpg" },
  ],
  total_pages: 1,
  total_results: 4,
};

export const movieSearch = {
  page: 1,
  results: [
    {
      id: 603,
      title: "Matrix",
      original_title: "The Matrix",
      poster_path: "/dXNAPwY7VrqMAo51EKhhCJfaGb5.jpg",
      release_date: "1999-03-30",
      overview: "Programmeur anonyme dans un service administratif le jour, Thomas Anderson devient Neo la nuit.",
    },
  ],
};

/** Two regular seasons + specials. Season 2 is airing: 2 of its 4 episodes are out, the 3rd airs soon. */
export const tvReturning = {
  id: 9001,
  name: "Les Veilleurs",
  original_name: "The Watchers",
  poster_path: "/watchers.jpg",
  first_air_date: "2024-09-05",
  status: "Returning Series",
  number_of_episodes: 12,
  seasons: [
    { season_number: 0, episode_count: 3, air_date: "2024-08-01" },
    { season_number: 1, episode_count: 6, air_date: "2024-09-05" },
    { season_number: 2, episode_count: 4, air_date: "2025-10-02" },
  ],
  last_episode_to_air: { season_number: 2, episode_number: 2, air_date: "2025-10-09" },
  next_episode_to_air: { season_number: 2, episode_number: 3, air_date: "2025-10-16" },
};

/** Finished: 2 seasons, nothing left to air. */
export const tvEnded = {
  id: 9002,
  name: "Terminus",
  original_name: "Terminus",
  poster_path: "/terminus.jpg",
  first_air_date: "2019-03-01",
  status: "Ended",
  number_of_episodes: 15,
  seasons: [
    { season_number: 0, episode_count: 2, air_date: null },
    { season_number: 1, episode_count: 8, air_date: "2019-03-01" },
    { season_number: 2, episode_count: 7, air_date: "2020-04-10" },
  ],
  last_episode_to_air: { season_number: 2, episode_number: 7, air_date: "2020-05-22" },
  next_episode_to_air: null,
};

export const movieDetails = {
  id: 603,
  title: "Matrix",
  original_title: "The Matrix",
  poster_path: "/dXNAPwY7VrqMAo51EKhhCJfaGb5.jpg",
  release_date: "1999-03-30",
  runtime: 136,
};
