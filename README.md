# AniSync

Suis tes animes **une seule fois** : chaque épisode +1, changement de statut ou note est écrit en même temps sur **MyAnimeList** et **AniList**.
Application mono-utilisateur, auto-hébergée (Dokploy, Docker), en français.

- Next.js 15 (App Router, standalone) · Tailwind CSS v4 · shadcn/ui · TanStack Query
- SQLite (better-sqlite3 + Drizzle, migrations automatiques au démarrage)
- Jetons OAuth chiffrés au repos (AES-256-GCM), jamais envoyés au navigateur
- PWA installable (iOS / Android)

## Architecture en bref

```
navigateur ──► middleware (session JWT HS256) ──► Route Handlers /api/*
                                                   │
                                   lib/sync.ts (cache liste 60 s, écritures parallèles)
                                     │                       │
                                 lib/mal.ts            lib/anilist.ts
                     (OAuth PKCE plain, refresh)   (OAuth code, GraphQL)
                                     │                       │
                                     └──── SQLite /data ─────┘
                                (connections chiffrées, id_map)
```

- La clé canonique d'une entrée est **l'id MAL** ; les paires MAL ↔ AniList sont mises en cache dans `id_map`.
- `lib/mapping.ts` et `lib/merge.ts` sont des fonctions pures, couvertes par les tests (`pnpm test`).
- Une écriture part en parallèle vers les deux services (`Promise.allSettled`) ; l'UI est optimiste et annule service par service en cas d'échec.

---

## 1. Développement local

Prérequis : Node.js 22+ et pnpm 11 (`npm i -g pnpm@11`).

```bash
pnpm install
cp .env.example .env.local     # puis remplis les valeurs (voir ci-dessous)
pnpm dev                        # http://localhost:3000
```

Variables d'environnement (toutes validées au démarrage, l'app s'arrête avec un message clair si l'une est invalide) :

| Variable | Rôle |
|---|---|
| `APP_URL` | URL publique, sans slash final (`http://localhost:3000` en local). Sert à construire les redirect URIs. |
| `APP_PASSWORD` | Mot de passe de connexion à l'app. |
| `APP_SECRET` | ≥ 32 caractères. Signe la session et chiffre les jetons. `openssl rand -base64 48` |
| `MAL_CLIENT_ID` | Client ID de l'app MyAnimeList. |
| `MAL_CLIENT_SECRET` | Optionnel : présent pour une app MAL de type « web ». |
| `ANILIST_CLIENT_ID` / `ANILIST_CLIENT_SECRET` | Identifiants du client AniList. |
| `DATABASE_PATH` | Fichier SQLite (`./data/anisync.db` en local, `/data/anisync.db` en prod). |

> ⚠️ Changer `APP_SECRET` invalide la session **et** rend illisibles les jetons stockés : il faudra reconnecter MAL et AniList.

Scripts : `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate` (génère une migration après modification de `lib/schema.ts`).

## 2. Créer les clients OAuth

### MyAnimeList
1. Va sur <https://myanimelist.net/apiconfig> → **Create ID**.
2. **App Type : `web`** (tu obtiens un Client ID **et** un Client Secret).
3. **App Redirect URL** : `${APP_URL}/api/auth/mal/callback`
   (ex. `https://anisync.example.com/api/auth/mal/callback`, ou `http://localhost:3000/api/auth/mal/callback` en local).
4. Remplis les champs obligatoires (nom, description, homepage = ton `APP_URL`), puis copie `MAL_CLIENT_ID` et `MAL_CLIENT_SECRET`.

MAL n'accepte qu'**une seule** redirect URL par client : crée un client séparé pour le dev local si besoin.

### AniList
1. Va sur <https://anilist.co/settings/developer> → **Create New Client**.
2. **Redirect URL** : `${APP_URL}/api/auth/anilist/callback`.
3. Copie l'**ID** (`ANILIST_CLIENT_ID`) et le **Secret** (`ANILIST_CLIENT_SECRET`).

Les deux URIs exactes sont affichées (avec bouton copier) dans **Paramètres** une fois l'app lancée.

## 3. Déploiement sur Dokploy

L'app tourne dans un seul conteneur ; tout l'état est dans le volume `/data`.

### Option A : Application (Dockerfile), recommandé
1. **Create Application** → source **Git** (GitHub) → dépôt `noah-blanchard/anisync`, branche `main`.
2. **Build Type : Dockerfile** (chemin `Dockerfile`, contexte `.`).
3. **Environment** : colle tes variables (cf. `.env.example`) avec `APP_URL=https://ton-domaine` et `DATABASE_PATH=/data/anisync.db`.
4. **Advanced → Volumes / Mounts** : ajoute un **Volume** (named volume, pas un bind mount) monté sur **`/data`**.
   Un bind mount vers un dossier de l'hôte doit être accessible en écriture par l'uid **1000** (`chown 1000:1000 <dossier>`).
5. **Domains** : ajoute ton domaine, **port du conteneur 3000**, active **HTTPS** avec **Let's Encrypt**.
6. **Deploy**. Le healthcheck interroge `/api/health` ; les logs doivent afficher `[anisync] base de données prête`.
7. Une fois le domaine actif, enregistre les redirect URIs définitives (`https://ton-domaine/api/auth/mal/callback` et `/api/auth/anilist/callback`) chez MAL et AniList.
8. Ouvre l'app, connecte-toi, puis **Paramètres → Connecter** MyAnimeList et AniList.

### Option B : Compose
Crée une app **Compose** pointant sur le dépôt : `docker-compose.yml` déclare le service, le port 3000, le volume nommé `anisync-data:/data`, `env_file: .env` et `restart: unless-stopped`. Fournis le `.env` via l'onglet Environment de Dokploy, puis ajoute le domaine sur le port 3000.

### Sans Dokploy
```bash
docker compose up -d --build
```

## 4. Sauvegarde

Tout l'état tient dans **`/data/anisync.db`** (jetons chiffrés + cache des correspondances d'ids). Les listes elles-mêmes restent sur MAL et AniList.

```bash
# le plus sûr : arrêter, copier, redémarrer (quelques secondes)
docker stop <conteneur>
docker cp <conteneur>:/data/anisync.db ./anisync-$(date +%F).db
docker start <conteneur>

# à chaud : copier tout le dossier (la base est en mode WAL, garder .db, .db-wal et .db-shm ensemble)
docker cp <conteneur>:/data ./anisync-backup-$(date +%F)
```

Si ta version de Dokploy propose les sauvegardes de volumes, programme-en une sur le volume monté sur `/data`.

Pour restaurer : arrête le conteneur, remplace `/data/anisync.db` (et supprime `anisync.db-wal` / `-shm`), redémarre. Garde le même `APP_SECRET`, sinon les jetons sont illisibles.

## 5. Dépannage

| Symptôme | Cause / solution |
|---|---|
| L'app s'arrête au démarrage avec « Configuration invalide » | Une variable manque ou est invalide ; le message liste lesquelles. `APP_SECRET` doit faire ≥ 32 caractères, `APP_URL` doit commencer par `http(s)://`. |
| `invalid_request` / `redirect_uri` invalide (MAL ou AniList) | L'URI enregistrée doit être **strictement identique** à celle affichée dans Paramètres (protocole, domaine, pas de slash final). Vérifie `APP_URL`. |
| MAL : `invalid_grant` ou erreur PKCE / `code_verifier` | Le flux a expiré (10 min) ou a été lancé dans un autre navigateur : relance « Connecter ». AniSync utilise PKCE `plain` (MAL ne supporte pas S256). Pour une app de type « web », `MAL_CLIENT_SECRET` est obligatoire ; pour le type « other », laisse-le vide. |
| MAL : `invalid_client` | Mauvais `MAL_CLIENT_ID` / secret, ou secret fourni pour une app « other ». |
| AniList : bannière « jeton expire bientôt » ou erreur `Invalid token` | Les jetons AniList durent ~1 an sans refresh : clique **Reconnecter** (Paramètres ou bannière). |
| Toasts « trop de requêtes » / erreurs 429 | AniList limite à ~30-90 requêtes/min. AniSync respecte `Retry-After` (2 essais max) ; attends une minute. L'alignement en masse espace ses écritures d'environ 1 s. |
| `SQLITE_CANTOPEN` / dossier non accessible en écriture | Le volume `/data` n'est pas inscriptible par l'uid 1000 : utilise un volume nommé ou `chown 1000:1000`. |
| Redirection vers une mauvaise URL après login / OAuth | `APP_URL` ne correspond pas au domaine public (ex. `http` au lieu de `https`). |
| Cookie de session non conservé | En HTTPS, le cookie est `Secure` : accède à l'app via le domaine HTTPS configuré dans `APP_URL`. |

## Fonctionnement de la synchronisation

- **+1** : action principale, optimiste. Un anime « À voir » passe automatiquement « En cours ». Au dernier épisode, un toast propose « Marquer comme terminé » (avec note optionnelle).
- **Échec partiel** : toast « MAL ✓ / AniList ✗ : raison » avec **Réessayer** qui ne rejoue que le service en échec.
- **Désynchronisé** : badge ambre ; il ouvre une comparaison MAL / AniList avec « Garder MAL », « Garder AniList » ou « Prendre le max » (progression la plus haute avec son statut, meilleure note).
- **Tout vérifier** : liste toutes les entrées désynchronisées et propose « Aligner sur le max » en masse.
- Un anime sans `idMal` sur AniList est marqué « AniList uniquement », et un anime absent d'AniList « MAL uniquement » ; les écritures ne vont alors que vers le service concerné.
- Si un seul service est connecté, l'app fonctionne avec lui et affiche une bannière pour connecter l'autre.

Raccourcis clavier (desktop) : `/` recherche, `+` sur une carte focalisée = épisode suivant, `-` = épisode précédent.
