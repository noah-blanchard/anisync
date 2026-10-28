# AniSync

Track your anime **once**: every +1 episode, status change or score is written to **MyAnimeList** and **AniList** at the same time.
Single-user, self-hosted (Dokploy, Docker). The interface is in French.

- Next.js 15 (App Router, standalone) · Tailwind CSS v4 · shadcn/ui · TanStack Query
- SQLite (better-sqlite3 + Drizzle, migrations run automatically at startup)
- OAuth tokens encrypted at rest (AES-256-GCM), never sent to the browser
- Installable PWA (iOS / Android)

## Architecture at a glance

```
browser ──► middleware (HS256 JWT session) ──► Route Handlers /api/*
                                                │
                               lib/sync.ts (60 s list cache, parallel writes)
                                 │                       │
                             lib/mal.ts            lib/anilist.ts
                 (OAuth PKCE plain, refresh)   (OAuth code grant, GraphQL)
                                 │                       │
                                 └──── SQLite /data ─────┘
                             (encrypted connections, id_map)
```

- The canonical key of an entry is the **MAL id**; MAL ↔ AniList id pairs are cached in `id_map`.
- `lib/mapping.ts` and `lib/merge.ts` are pure functions covered by unit tests (`pnpm test`).
- A write goes to both services in parallel (`Promise.allSettled`); the UI is optimistic and rolls back per service on failure.

---

## 1. Local development

Requirements: Node.js 22+ and pnpm 11 (`npm i -g pnpm@11`).

```bash
pnpm install
cp .env.example .env.local     # then fill in the values (see below)
pnpm dev                        # http://localhost:3000
```

Environment variables (all validated at startup; the app exits with a clear message if one is invalid):

| Variable | Purpose |
|---|---|
| `APP_URL` | Public URL, no trailing slash (`http://localhost:3000` locally). Used to build the OAuth redirect URIs. |
| `APP_PASSWORD` | Password to log into the app. |
| `APP_SECRET` | ≥ 32 characters. Signs the session and encrypts tokens. `openssl rand -base64 48` |
| `MAL_CLIENT_ID` | MyAnimeList app client ID. |
| `MAL_CLIENT_SECRET` | Optional: present for a MAL app of type "web". |
| `ANILIST_CLIENT_ID` / `ANILIST_CLIENT_SECRET` | AniList client credentials. |
| `DATABASE_PATH` | SQLite file (`./data/anisync.db` locally, `/data/anisync.db` in production). |

> ⚠️ Changing `APP_SECRET` invalidates the session **and** makes stored tokens unreadable: you will have to reconnect MAL and AniList.

Scripts: `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate` (generates a migration after changing `lib/schema.ts`).

## 2. Create the OAuth clients

### MyAnimeList
1. Go to <https://myanimelist.net/apiconfig> → **Create ID**.
2. **App Type: `web`** (you get a Client ID **and** a Client Secret).
3. **App Redirect URL**: `${APP_URL}/api/auth/mal/callback`
   (e.g. `https://anisync.example.com/api/auth/mal/callback`, or `http://localhost:3000/api/auth/mal/callback` locally).
4. Fill in the required fields (name, description, homepage = your `APP_URL`), then copy `MAL_CLIENT_ID` and `MAL_CLIENT_SECRET`.

MAL accepts **only one** redirect URL per client: create a separate client for local development if needed.

### AniList
1. Go to <https://anilist.co/settings/developer> → **Create New Client**.
2. **Redirect URL**: `${APP_URL}/api/auth/anilist/callback`.
3. Copy the **ID** (`ANILIST_CLIENT_ID`) and the **Secret** (`ANILIST_CLIENT_SECRET`).

Both exact URIs are shown (with a copy button) on the **Paramètres** (settings) page once the app is running.

## 3. Deploying on Dokploy

The app runs as a single container; all state lives in the `/data` volume.

### Option A: Application (Dockerfile), recommended
1. **Create Application** → source **Git** (GitHub) → repository `noah-blanchard/anisync`, branch `main`.
2. **Build Type: Dockerfile** (path `Dockerfile`, context `.`).
3. **Environment**: paste your variables (see `.env.example`) with `APP_URL=https://your-domain` and `DATABASE_PATH=/data/anisync.db`.
   Use the runtime **Environment** section only: leave **Build-time Arguments** and **Build-time Secrets** empty. Nothing is needed at build time, and build args would bake secrets into the image.
   ⚠️ Do not copy `DATABASE_PATH=./data/anisync.db` from your local `.env`: inside the container only `/data` is writable (error `EACCES … mkdir '/app/data'`).
4. **Advanced → Volumes / Mounts**: add a **Volume** (named volume, not a bind mount) mounted at **`/data`**.
   A bind mount to a host folder must be writable by uid **1000** (`chown 1000:1000 <folder>`).
5. **Domains**: add your domain, **container port 3000**, enable **HTTPS** with **Let's Encrypt**.
6. **Deploy**. The healthcheck hits `/api/health`; the logs should show `[anisync] base de données prête` (database ready).
7. Once the domain is live, register the final redirect URIs (`https://your-domain/api/auth/mal/callback` and `/api/auth/anilist/callback`) with MAL and AniList.
8. Open the app, log in, then **Paramètres → Connecter** for MyAnimeList and AniList.

Environment changes only apply after a **Redeploy**.

### Option B: Compose
Create a **Compose** app pointing at the repository: `docker-compose.yml` declares the service, port 3000, the named volume `anisync-data:/data`, `env_file: .env` and `restart: unless-stopped`. Provide the `.env` through Dokploy's Environment tab, then add the domain on port 3000.

### Without Dokploy
```bash
docker compose up -d --build
```

## 4. Backup

All state is in **`/data/anisync.db`** (encrypted tokens + id mapping cache). The lists themselves stay on MAL and AniList.

```bash
# safest: stop, copy, restart (a few seconds)
docker stop <container>
docker cp <container>:/data/anisync.db ./anisync-$(date +%F).db
docker start <container>

# hot copy: copy the whole folder (the database is in WAL mode, keep .db, .db-wal and .db-shm together)
docker cp <container>:/data ./anisync-backup-$(date +%F)
```

If your Dokploy version offers volume backups, schedule one on the volume mounted at `/data`.

To restore: stop the container, replace `/data/anisync.db` (and delete `anisync.db-wal` / `-shm`), restart. Keep the same `APP_SECRET`, otherwise the tokens are unreadable.

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| The app exits at startup with "Configuration invalide" | A variable is missing or invalid; the message lists which ones. `APP_SECRET` must be ≥ 32 characters, `APP_URL` must start with `http(s)://`. |
| 502 Bad Gateway on the domain | The container is not running: check the app **Logs** in Dokploy (usually an env error or an unwritable `DATABASE_PATH`), and that the domain uses container port 3000. |
| `EACCES … mkdir '/app/data'` | `DATABASE_PATH` is relative (local value). Set `DATABASE_PATH=/data/anisync.db` or remove it. |
| `invalid_request` / invalid `redirect_uri` (MAL or AniList) | The registered URI must be **exactly** the one shown in Paramètres (protocol, domain, no trailing slash). Check `APP_URL`. |
| MAL: `invalid_grant` or PKCE / `code_verifier` error | The flow expired (10 min) or was started in another browser: click "Connecter" again. AniSync uses PKCE `plain` (MAL does not support S256). For a "web" app, `MAL_CLIENT_SECRET` is required; for the "other" type, leave it empty. |
| MAL: `invalid_client` | Wrong `MAL_CLIENT_ID` / secret, or a secret provided for an "other" app. |
| AniList: "token expires soon" banner or `Invalid token` error | AniList tokens last ~1 year with no refresh: click **Reconnecter** (in Paramètres or the banner). |
| "Too many requests" toasts / 429 errors | AniList allows ~30-90 requests/min. AniSync honours `Retry-After` (2 retries max); wait a minute. Bulk alignment spaces its writes by about 1 s. |
| `SQLITE_CANTOPEN` / folder not writable | The `/data` volume is not writable by uid 1000: use a named volume or `chown 1000:1000`. |
| Redirected to the wrong URL after login / OAuth | `APP_URL` does not match the public domain (e.g. `http` instead of `https`). |
| Session cookie not kept | Over HTTPS the cookie is `Secure`: access the app through the HTTPS domain set in `APP_URL`. |

## How sync works

- **+1** is the primary action and is optimistic. An anime in "À voir" (plan to watch) automatically switches to "En cours" (watching). On the last episode, a toast offers "Marquer comme terminé" (mark as completed, with an optional score).
- **Partial failure**: a "MAL ✓ / AniList ✗ : reason" toast with **Réessayer** (retry), which replays only the failed service.
- **Out of sync**: an amber "Désynchronisé" badge opens a MAL / AniList side-by-side comparison with "Garder MAL", "Garder AniList" or "Prendre le max" (highest progress with its status, best score).
- **Tout vérifier** (check all) lists every out-of-sync entry and offers a bulk "Aligner sur le max".
- An anime with no `idMal` on AniList is marked "AniList uniquement", and one missing from AniList "MAL uniquement"; writes then only go to the service that has it.
- If only one service is connected, the app keeps working with it and shows a banner to connect the other.

Keyboard shortcuts (desktop): `/` search, `+` on a focused card = next episode, `-` = previous episode.
