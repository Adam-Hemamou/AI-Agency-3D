# AI Agency 3D

Agence commerciale virtuelle en 3D pilotant des agents IA : prospection de créateurs YouTube,
analyse de leur potentiel international et proposition de doublage vidéo (HeyGen).

**État : phases 0 (fondations) et 1 (moteur de missions) terminées ; phase 2 (agence 3D) en cours de validation.** Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

> Prototype : aucune action externe réelle n'est effectuée (`MODE_SIMULATION=true`).

## Prérequis

- **Node.js 22.12 ou plus récent** (testé avec 24.15)
- **Docker Desktop**, démarré

## Premier démarrage

```bash
# 1. Installer les dépendances (génère aussi le client Prisma)
npm install

# 2. Créer le fichier de configuration (puis changer les mots de passe)
cp .env.example .env

# 3. Démarrer MySQL
npm run db:up

# 4. Lancer l'API et l'interface
npm run dev
```

Ouvrir ensuite **http://localhost:5173** : l’agence 3D s’affiche. Le bouton « Système » (en haut à gauche) doit afficher trois voyants verts :
API en ligne, base de données connectée, mode simulation actif.

## Commandes utiles

| Commande                            | Effet                                              |
| ----------------------------------- | -------------------------------------------------- |
| `npm run dev`                       | Lance l'API (port 3001) et l'interface (port 5173) |
| `npm run preview -w @agency/web`    | Aperçu du build de production (port 4173)          |
| `npm run check`                     | Vérifie les types, le lint et les tests            |
| `npm test`                          | Lance tous les tests (MySQL doit être démarré)     |
| `npm run lint` / `npm run format`   | Lint / formatage automatique                       |
| `npm run db:up` / `npm run db:down` | Démarre / arrête MySQL                             |
| `npm run db:logs`                   | Journaux MySQL                                     |
| `npm run db:migrate`                | Crée et applique une migration Prisma              |
| `npm run db:studio`                 | Explorateur visuel de la base                      |
| `npm run demo:setup`                | (Re)crée la base de démonstration fictive          |
| `npm run dev:demo`                  | Démo : API (port 3101) et interface (port 5174)    |

## Organisation

| Dossier           | Contenu                                                    |
| ----------------- | ---------------------------------------------------------- |
| `apps/web`        | Interface React et scène 3D                                |
| `apps/server`     | API Express et Prisma                                      |
| `packages/shared` | Types, statuts, salles, codes d'erreur et schémas partagés |
| `docker/`         | Initialisation de MySQL                                    |
| `docs/`           | Documentation                                              |

## Problèmes fréquents

- **« Base de données : hors ligne »** : Docker Desktop n'est pas démarré, ou MySQL non plus (`npm run db:up`).
- **« Configuration invalide (fichier .env) »** : le message indique la variable fautive. Comparer avec `.env.example`.
- **Port 3306 déjà utilisé** : changer `MYSQL_PORT` dans `.env`, ainsi que le port dans `DATABASE_URL`.
- **Mot de passe MySQL modifié après le premier démarrage** : MySQL garde l'ancien. Pour repartir de zéro
  (efface les données) : `docker compose down -v` puis `npm run db:up`.
- **« MySQL est injoignable pour les tests d'intégration »** : `npm test` a besoin de MySQL (base `ai_agency_test`,
  distincte de la base de développement). Démarrer Docker Desktop puis `npm run db:up`. Sans base :
  `npm run test:unit -w @agency/server`.
- **Après avoir récupéré une nouvelle migration** : `npm run db:migrate` (applique les migrations et régénère le client Prisma).

## Démonstration du CRM (données fictives)

Pour découvrir le CRM avec des dossiers déjà remplis, sans toucher à vos vraies données :

```bash
npm run demo:setup   # crée ai_agency_demo et y charge 13 prospects fictifs
npm run dev:demo     # puis ouvrir http://localhost:5174
```

- La démo utilise une **base séparée** (`ai_agency_demo`) et ses **propres ports** : elle peut tourner en
  même temps que l’application réelle. Toute base dont le nom ne finit pas par `_demo` est refusée.
- Tout est fictif (créateurs, statistiques, adresses en `.example`). Aucun e-mail, aucun doublage et
  aucune API payante ne sont déclenchés : les envois sont **simulés** et signalés comme tels.
- `npm run demo:setup` remet la démo dans son état initial à tout moment.

## Utiliser l’agence

- **Survoler** une salle la met en évidence ; **cliquer** l’ouvre et affiche ses missions.
- **Glisser** pour se déplacer, **molette** pour zoomer, **clic droit** pour pivoter légèrement.
- **Échap** ou **✕** ferme le panneau ; **Vue d’ensemble** recadre toute l’agence.
- La liste des salles, en bas à gauche, permet les mêmes actions.
- **Cliquer une mission** ouvre le **dossier du prospect** au centre, sur la section de la salle
  (Analyse, Validation, Doublage, Commercial, E-mails, Suivi…). Toutes les sections restent accessibles
  par les onglets. **Échap** ou **✕** ferme le dossier sans fermer le panneau.
- Un prospect garde **un seul dossier** d’une salle à l’autre : chaque mission y renvoie.

## API

Routes disponibles (détail dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#7-bis-api-des-missions)) :
`GET /api/health`, `POST|GET /api/missions`, `GET /api/missions/:id`, `GET /api/missions/:id/events`,
`POST /api/missions/:id/transitions`, `POST /api/missions/:id/validation`.

CRM : `GET /api/prospects`, `GET /api/prospects/:id/dossier`, `POST /api/prospects/:id/decisions`,
`POST /api/prospects/:id/email/decisions`, `POST /api/prospects/:id/email/drafts`,
`POST /api/prospects/:id/email/simulated-send`, `POST /api/prospects/:id/replies`,
`POST /api/prospects/:id/followups`, `PATCH /api/prospects/:id/followup`, `POST /api/prospects/:id/notes`.
