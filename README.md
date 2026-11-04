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

## Utiliser l’agence

- **Survoler** une salle la met en évidence ; **cliquer** l’ouvre et affiche ses missions.
- **Glisser** pour se déplacer, **molette** pour zoomer, **clic droit** pour pivoter légèrement.
- **Échap** ou **✕** ferme le panneau ; **Vue d’ensemble** recadre toute l’agence.
- La liste des salles, en bas à gauche, permet les mêmes actions.

## API

Routes disponibles (détail dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#7-bis-api-des-missions)) :
`GET /api/health`, `POST|GET /api/missions`, `GET /api/missions/:id`, `GET /api/missions/:id/events`,
`POST /api/missions/:id/transitions`, `POST /api/missions/:id/validation`.
