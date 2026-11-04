# Architecture — AI Agency 3D

> Document de référence, validé le 29/10/2026.
> Il décrit **ce qui est décidé**. Toute évolution importante doit y être reportée (section « Journal des décisions »).

## 1. Vision

Application de bureau à usage personnel représentant une agence commerciale virtuelle en 3D (vue isométrique).
Des agents IA prospectent des créateurs de contenu, évaluent leur potentiel international et leur proposent
un service de traduction et de doublage vidéo (HeyGen). Les décisions importantes restent validées par l'utilisateur.

**Règle absolue du prototype : aucune action externe réelle.** Recherches, e-mails et traitements HeyGen sont simulés,
puis intégrés un par un.

## 2. Décisions validées

| Sujet                      | Décision                                                                                                          | Raison                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Forme de l'application     | Application **web locale** d'abord, transformée en application de bureau avec **Electron** une fois fonctionnelle | Développement plus rapide, même code ensuite                        |
| Frontend                   | React 19 + TypeScript + **Vite**                                                                                  | Démarrage instantané, rechargement à chaud                          |
| 3D                         | **Three.js + React Three Fiber + drei**                                                                           | La 3D s'écrit comme des composants React                            |
| Panneaux                   | **HTML** superposé à la 3D, pas en 3D                                                                             | Lisibilité et facilité de développement des formulaires et tableaux |
| Données serveur (frontend) | **TanStack Query**                                                                                                | Cache et rafraîchissement automatiques                              |
| État d'interface           | **Zustand** (à partir de la phase 2)                                                                              | État partagé simple entre 3D et panneaux                            |
| Backend                    | Node.js + **Express 5** + TypeScript                                                                              | Demandé, simple, éprouvé                                            |
| Base de données            | **MySQL 8.4** dans **Docker**                                                                                     | Installation en une commande, isolée du système                     |
| Accès aux données          | **Prisma 7** (adaptateur `@prisma/adapter-mariadb`)                                                               | Typage de bout en bout, migrations versionnées                      |
| Validation                 | **Zod**, schémas dans le paquet partagé                                                                           | Mêmes règles côté frontend et backend                               |
| Temps réel                 | WebSocket (**Socket.IO**, à partir de la phase 3)                                                                 | Les statuts arrivent dans la 3D sans recharger                      |
| Automatisations            | **n8n** (à partir de la phase 6)                                                                                  | Exécute les actions externes ; ne contient pas de règles métier     |
| Plateforme de prospection  | **YouTube uniquement** au départ (API officielle)                                                                 | Seule plateforme avec une API ouverte adaptée                       |
| Tests                      | **Vitest** (+ Supertest côté API, Testing Library côté interface)                                                 | Même outil partout                                                  |
| Qualité                    | ESLint + Prettier, TypeScript strict                                                                              | Code cohérent                                                       |

### Principe directeur : le backend décide, les autres exécutent ou affichent

- **Backend** = seule source de vérité (missions, CRM, règles, historique).
- **n8n** = exécute les actions externes et renvoie le résultat par webhook.
- **3D** = affiche l'état diffusé par le backend. Elle ne décide jamais rien.

## 3. Vue d'ensemble

```
┌───────────────────────────────────────────────────────────┐
│  FRONTEND  apps/web  (React + Vite)                       │
│   Scène 3D (R3F)  ◄── état UI ──►  Panneaux HTML          │
│                 TanStack Query (données serveur)          │
└──────────────┬─────────────────────────▲──────────────────┘
          REST │ /api/*                  │ WebSocket (phase 3)
┌──────────────▼─────────────────────────┴──────────────────┐
│  BACKEND  apps/server  (Express)                          │
│   Moteur de missions · Modules métier · Fournisseurs      │
│   Garde-fou MODE_SIMULATION                               │
└──────┬──────────────────────────────────────┬─────────────┘
       │ Prisma                               │ webhooks (phase 6)
   ┌───▼────┐                          ┌──────▼──────┐
   │ MySQL  │                          │    n8n      │
   └────────┘                          └─────────────┘
              packages/shared : types, statuts, schémas
```

## 4. Structure des dossiers

```
AI-Agency-3D/
├── apps/
│   ├── web/                    # Frontend
│   │   └── src/
│   │       ├── api/            # Client HTTP + hooks TanStack Query
│   │       ├── scene/          # 3D : camera/, layout/, rooms/, agents/, props/, indicators/
│   │       ├── ui/             # panels/, dashboard/, components/ (réutilisables)
│   │       ├── features/       # Logique par domaine (missions, crm…)
│   │       ├── stores/         # Zustand
│   │       └── test/           # Configuration des tests
│   ├── server/                 # Backend
│   │   ├── prisma/             # schema.prisma + migrations/
│   │   └── src/
│   │       ├── config/         # Lecture et validation du .env
│   │       ├── db/             # Client Prisma
│   │       ├── errors/         # AppError + gestionnaire d'erreurs central
│   │       ├── routes/         # Routes HTTP
│   │       ├── missions/       # (phase 1) Moteur : états, transitions, historique
│   │       ├── modules/        # (phase 4) creators, analyses, dubbing, emails, followup
│   │       ├── providers/      # (phase 4) interfaces + mock/ + real/
│   │       ├── workers/        # (phase 4) exécution des missions
│   │       ├── realtime/       # (phase 3) diffusion WebSocket
│   │       └── generated/      # Client Prisma généré (non versionné)
│   └── desktop/                # (phase 7) Coque Electron
├── packages/shared/            # Types, statuts, salles, codes d'erreur, schémas Zod
├── automations/n8n/            # (phase 6) Workflows n8n exportés
├── docker/mysql/init/          # Script SQL exécuté à la création de la base
├── docs/                       # Documentation
├── docker-compose.yml
└── package.json                # Monorepo (workspaces npm)
```

Les dossiers marqués d'une phase seront créés à ce moment-là, pas avant.

## 5. Les sept salles

Identifiants définis dans `packages/shared/src/rooms.ts`, dans l'ordre du pipeline :

| Identifiant    | Salle                           | Rôle                                                     |
| -------------- | ------------------------------- | -------------------------------------------------------- |
| `prospecting`  | Salle de prospection            | Recherche de YouTubeurs                                  |
| `analysis`     | Salle d'analyse                 | Potentiel commercial et international                    |
| `director`     | Mon bureau                      | Validation ou refus des prospects (humain)               |
| `dubbing`      | Studio de doublage              | Choix d'un extrait de 30 à 60 s, échantillon HeyGen      |
| `copywriting`  | Salle commerciale               | Propositions personnalisées avec lien vers l'échantillon |
| `email_review` | Salle de validation des e-mails | Vérification et approbation avant envoi (humain)         |
| `followup`     | Salle de suivi                  | Réponses, opportunités, relances                         |

Les libellés et la fonction affichée de chaque salle (`ROOM_LABELS`, `ROOM_DESCRIPTIONS`) sont dans
`packages/shared/src/rooms.ts`. Les identifiants n'ont pas changé depuis la phase 0.

## 6. Missions

### Statuts (`packages/shared/src/missions.ts`)

`pending` (en attente) · `in_progress` (en cours) · `awaiting_validation` (en attente de validation) ·
`paused` (en pause) · `completed` (terminée) · `cancelled` (annulée) · `blocked` (bloquée)

Les sept statuts suffisent à représenter le cycle de vie. Deux informations complémentaires
sont portées par des **champs**, et non par de nouveaux statuts :

- **le résultat de la validation humaine** (`validationOutcome` : `approved`, `changes_requested`, `rejected`,
  avec `validatedAt` et `validatedBy`). Sans ce champ, « terminée » ne dirait pas si le résultat a été approuvé,
  et « annulée » ne distinguerait pas un abandon d'un refus ;
- **le suivi des tentatives** (`attemptCount`, `maxAttempts`, `lastErrorCode`, `lastErrorMessage`).

### Cycle de vie (`packages/shared/src/missionLifecycle.ts`, phase 1 ✅)

Les règles sont définies **une seule fois** dans le paquet partagé. Le serveur les applique ;
l'interface les utilisera pour n'afficher que les actions possibles.

**Actions de cycle de vie** (`POST /api/missions/:id/transitions`) :

| Action                  | Depuis                                                               | Vers                  | Conditions                                      |
| ----------------------- | -------------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| `start`                 | `pending`                                                            | `in_progress`         | Tentatives restantes ; +1 tentative             |
| `pause`                 | `in_progress`                                                        | `paused`              |                                                 |
| `resume`                | `paused`                                                             | `in_progress`         | Ne compte pas comme une nouvelle tentative      |
| `submit_for_validation` | `in_progress`                                                        | `awaiting_validation` | Uniquement si la mission exige une validation   |
| `complete`              | `in_progress`                                                        | `completed`           | **Interdit** si la mission exige une validation |
| `block`                 | `pending`, `in_progress`                                             | `blocked`             | Motif obligatoire                               |
| `unblock`               | `blocked`                                                            | `pending`             | Efface la dernière erreur                       |
| `cancel`                | `pending`, `in_progress`, `awaiting_validation`, `paused`, `blocked` | `cancelled`           | Motif obligatoire                               |

**Décisions de validation humaine** (`POST /api/missions/:id/validation`), uniquement depuis `awaiting_validation`
et **uniquement par un utilisateur** (un agent ou le système reçoit `FORBIDDEN_ACTOR`) :

| Décision          | Vers          | Résultat enregistré | Motif       |
| ----------------- | ------------- | ------------------- | ----------- |
| `approve`         | `completed`   | `approved`          | facultatif  |
| `request_changes` | `in_progress` | `changes_requested` | obligatoire |
| `reject`          | `cancelled`   | `rejected`          | obligatoire |

`completed` et `cancelled` sont des états finaux : plus aucune action n'est possible.

**Garanties de la validation humaine :**

- `requiresValidation` est fixé à la création et ne peut plus être modifié ;
- la seule voie vers `completed` pour une telle mission passe par `approve` ;
- une nouvelle soumission efface la décision précédente.

### Moteur de missions (`apps/server/src/missions/missionService.ts`)

- **Seul point d'écriture** des tables `missions` et `mission_events`. Les routes HTTP ne font que valider
  l'entrée puis appeler le moteur. Aucune route ne permet d'écrire un statut directement.
- **Atomicité** : la modification de la mission et l'écriture de son événement sont faites dans une même
  transaction. Si l'une échoue, rien n'est enregistré.
- **Modifications concurrentes** : chaque mission porte une `version`. La mise à jour est conditionnée à la
  version lue ; si une autre requête est passée entre-temps, l'action est refusée (`CONCURRENT_MODIFICATION`).
  Le client peut aussi transmettre `expectedVersion` pour refuser une action basée sur un affichage périmé.
- **Origine des actions** : les requêtes HTTP sont attribuées à l'utilisateur (`user` / `owner`). Les agents et
  le système appelleront le moteur directement, avec leur propre identité (phase 4).

### Historique (`mission_events`)

Chaque création, action ou décision ajoute un événement contenant : la date (à la milliseconde), l'origine
(`actorType` + `actorId`), l'action, les statuts avant/après, les **champs modifiés avec leur ancienne et
nouvelle valeur** (`changes`) et le motif éventuel. Une action refusée n'ajoute rien.

**La base elle-même refuse toute modification ou suppression d'un événement** (déclencheurs MySQL créés par
la migration), même depuis un outil SQL.

## 7. Modèle de données

### Tables existantes (phase 1)

**`missions`** : `id` (UUID v7, triable par date), `type`, `room`, `status`, `priority` (1 à 5), `input` (JSON),
`output` (JSON, facultatif), `requires_validation`, `validation_outcome`, `validated_at`, `validated_by`,
`agent_id`, `attempt_count`, `max_attempts`, `last_error_code`, `last_error_message`, `version`,
`created_at`, `updated_at`, `started_at`, `finished_at`.

**`mission_events`** : `id` (auto-incrément, ordre strict), `mission_id`, `action`, `actor_type`, `actor_id`,
`from_status`, `to_status`, `changes` (JSON), `reason`, `created_at`.

Les colonnes `status`, `room`, `action`… sont des chaînes. Les valeurs autorisées restent définies **uniquement**
dans `packages/shared`, et seul le moteur écrit dans ces tables, après validation. Il n'y a pas d'enum Prisma,
qui dupliquerait ces listes.

`agent_id` n'a pas encore de clé étrangère : la table `agents` sera créée avec les agents.

### Tables à venir

- **Cœur** : `agents`
- **CRM** : `creators`, `creator_channels`, `analyses`, `decisions`, `videos`, `dubbing_samples`,
  `emails`, `email_replies`, `opportunities`, `followups`

## 7 bis. API des missions

Contrat (schémas Zod des requêtes et des réponses) : `packages/shared/src/missionApi.ts`.

| Méthode et route                     | Rôle                                                       | Réponse  |
| ------------------------------------ | ---------------------------------------------------------- | -------- |
| `POST /api/missions`                 | Créer une mission (statut `pending`)                       | 201      |
| `GET /api/missions`                  | Lister, filtrer (`status`, `room`, `type`), trier, paginer | 200      |
| `GET /api/missions/:id`              | Lire une mission                                           | 200, 404 |
| `GET /api/missions/:id/events`       | Historique, du plus ancien au plus récent                  | 200, 404 |
| `POST /api/missions/:id/transitions` | Action de cycle de vie                                     | 200, 409 |
| `POST /api/missions/:id/validation`  | Décision de validation humaine                             | 200, 409 |

Filtres de liste : plusieurs valeurs possibles (`?status=pending,blocked` ou `?status=pending&status=blocked`),
`sort=recent` (par défaut) ou `sort=priority`, `limit` (1 à 200, 50 par défaut) et `offset`.
Les champs inconnus sont refusés, tant dans les requêtes que dans les filtres.

## 8. Interface 3D

### Phase 2 ✅ : l'agence (`apps/web/src/scene`)

```
Accueil · Suivi · E-mails · Commerciale       (rangée de devant, côté caméra)
════════════════ couloir ════════════════      entrée à l'est
Prospection · Analyse · Mon bureau · Doublage  (rangée du fond)
```

Le flux du pipeline dessine un U : rangée du fond de gauche à droite, puis rangée de devant de droite à gauche.

| Élément                                           | Rôle                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `layout/agencyLayout.ts`                          | Plan (données pures) : dimensions, position des salles, portes, murs hauts et bas                         |
| `rooms/roomDesigns.ts`                            | Aménagement de chaque salle (données pures) : couleurs, type de sol, mobilier, objets muraux, pictogramme |
| `props/catalog.ts`                                | Emprise au sol et hauteur de chaque meuble                                                                |
| `props/*.tsx`                                     | Une trentaine de meubles low-poly construits à partir de formes simples (aucun fichier 3D externe)        |
| `props/registry.tsx`                              | Associe chaque type de meuble à son composant ; le typage interdit d'en oublier un                        |
| `rooms/Room.tsx`, `rooms/RoomShell.tsx`           | Salle **générique** : sol, murs avec porte, mobilier, zone de survol et de clic, surbrillance             |
| `layout/AgencyGrounds.tsx`                        | Socle façon maquette, couloir, décor, abords extérieurs                                                   |
| `camera/AgencyCamera.tsx`, `camera/cameraMath.ts` | Caméra isométrique orthographique, cadrages calculés                                                      |
| `labels/*`                                        | Étiquettes HTML des salles, repositionnées par la scène à chaque image                                    |
| `performance/*`                                   | Fusion des objets immobiles et ombres calculées une seule fois                                            |

**Murs** : seuls les murs du pourtour nord et ouest sont hauts (1,5). Tous les autres font 0,5, pour voir
l'intérieur des pièces. Les objets muraux (écrans, tableaux…) ne sont posés que sur les murs hauts ; ailleurs,
on utilise du mobilier sur pied (tableau blanc mobile, tableau de suivi…).

**Cohérence vérifiée automatiquement** (`roomDesigns.test.ts`) :

- aucun meuble ne déborde des murs ni n'en chevauche un autre ;
- l'accès aux portes reste libre ;
- les objets muraux sont sur des murs hauts, sans se chevaucher ;
- aucun meuble haut ne traverse un objet mural.

**Interactions** : survol → surbrillance de la salle (sol teinté, liseré lumineux, étiquette agrandie, curseur
main) ; clic → sélection, cadrage de la caméra et panneau ; Échap ou ✕ → fermeture et retour à la vue d'ensemble.
Un glisser de plus de 6 px n'est pas un clic. La liste des salles (en bas à gauche) offre les mêmes actions.

**Caméra** : glisser = se déplacer sur le sol, molette = zoomer vers le curseur, clic droit = pivoter
(±35° autour de l'angle isométrique). Le déplacement est borné à l'agence et le zoom est limité.
La vue d'ensemble et le cadrage d'une salle tiennent compte de la place prise par la liste et par le panneau.

**Connexion au CRM** : le panneau appelle `GET /api/missions?room=…&sort=priority&limit=50` à chaque ouverture.
Il affiche le nom et la fonction de la salle, le nombre total de missions, la répartition par statut et la liste
(type, statut, priorité, validation requise, date). Les états de chargement, d'erreur (avec « Réessayer ») et
de salle vide sont prévus. Aucune donnée de mission n'est conservée côté interface : l'API reste la source de vérité.
L'état partagé entre la 3D et les panneaux (`stores/agencyStore.ts`, Zustand) se limite à la salle survolée
et à la salle sélectionnée.

**Performance** :

- rendu « à la demande » : aucune image n'est calculée quand rien ne bouge ;
- les objets immobiles de chaque salle sont fusionnés en un maillage par matériau, ce qui fait passer de
  ~2 000 à ~300 appels de dessin ;
- un matériau par couleur pour toute la scène ;
- ombres calculées une seule fois ;
- ~15 000 triangles, aucune texture.

### Phases suivantes

| Composant        | Phase | Rôle                                               |
| ---------------- | ----- | -------------------------------------------------- |
| `StatusBeacon`   | 3     | Indicateurs 3D liés aux statuts réels des missions |
| `DashboardHUD`   | 3     | Tableau de bord global                             |
| `AgentCharacter` | 5     | Personnage animé selon un **état visuel**          |

Correspondance statut → état visuel de l'agent : `in_progress` → `working`, `awaiting_validation` → `waiting`,
`paused` → `paused`, `blocked` → `alert`, sinon `idle`. Une seule fonction fait cette correspondance :
brancher les vrais statuts ne demandera aucune réécriture des animations.

## 9. Sécurité du prototype

- `MODE_SIMULATION=true` par défaut. Seule la valeur exacte `false` le désactive ; toute autre valeur fait échouer le démarrage.
- Tout fournisseur réel devra lever `AppError.externalActionBlocked()` tant que le mode simulation est actif.
- L'API et MySQL n'écoutent que sur `127.0.0.1` (pas d'accès depuis le réseau).
- Les secrets sont dans `.env`, jamais versionné.

## 10. Gestion des erreurs

- Codes centralisés dans `packages/shared/src/errors.ts`.
- Côté serveur, toute erreur prévue est une `AppError` (code + statut HTTP + message).
- Format de réponse unique : `{ "error": { "code", "message", "details?" } }`.
- Les erreurs imprévues sont journalisées en détail mais renvoyées au client sous un message générique.
- Côté interface, `ApiClientError` reprend le code de l'API (ou `NETWORK_ERROR` / `INVALID_RESPONSE`).

| Code                      | HTTP | Cas                                                                       |
| ------------------------- | ---- | ------------------------------------------------------------------------- |
| `VALIDATION_ERROR`        | 400  | Entrée invalide ; `details` liste chaque champ fautif (`path`, `message`) |
| `NOT_FOUND`               | 404  | Mission ou route inexistante                                              |
| `FORBIDDEN_ACTOR`         | 403  | Décision de validation demandée par un agent ou le système                |
| `INVALID_TRANSITION`      | 409  | Action impossible depuis le statut actuel                                 |
| `VALIDATION_REQUIRED`     | 409  | Tentative de terminer une mission qui exige une validation                |
| `MAX_ATTEMPTS_REACHED`    | 409  | Plus de tentatives disponibles                                            |
| `CONCURRENT_MODIFICATION` | 409  | Mission modifiée entre-temps                                              |
| `DATABASE_UNAVAILABLE`    | 503  | MySQL injoignable                                                         |
| `INTERNAL_ERROR`          | 500  | Erreur imprévue                                                           |

Les refus du cycle de vie (409) indiquent dans `details` l'action tentée, le statut actuel et les actions
et décisions encore possibles.

## 10 bis. Tests

| Commande                                     | Contenu                                          | Base de données     |
| -------------------------------------------- | ------------------------------------------------ | ------------------- |
| `npm test` (racine)                          | Tous les tests des trois paquets                 | Oui (MySQL démarré) |
| `npm run test:unit -w @agency/server`        | Tests unitaires du serveur                       | Non                 |
| `npm run test:integration -w @agency/server` | Moteur de missions et routes, sur une vraie base | Oui                 |

Les tests d'intégration utilisent une **base dédiée `ai_agency_test`**, supprimée puis recréée et migrée à chaque
exécution, puis vidée entre chaque test. Par sécurité, son nom doit se terminer par `_test`, sinon les tests
refusent de démarrer. La base de développement n'est jamais touchée. On peut imposer une autre base avec
`TEST_DATABASE_URL`.

## 11. Plan de développement

| Phase                     | Contenu                                                                                 | État         |
| ------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| **0. Fondations**         | Monorepo, Docker MySQL, Prisma, paquet partagé, API santé, page de test 3D, tests, lint | ✅ Terminée  |
| **1. Moteur de missions** | Tables missions et historique, machine à états, API REST, tests                         | ✅ Terminée  |
| **2. Agence 3D**          | 7 salles aménagées, caméra, survol, sélection, panneau relié à l'API                    | ✅ À valider |
| 3. Panneaux connectés     | Panneaux de missions, tableau de bord, WebSocket, indicateurs                           | À faire      |
| 4. Pipeline simulé        | Les 7 salles enchaînées avec des fournisseurs simulés, validations humaines             | À faire      |
| 5. Agents vivants         | Animations liées aux statuts, déplacements                                              | À faire      |
| 6. Intégrations réelles   | IA → YouTube (lecture) → HeyGen → e-mails (en dernier), via n8n                         | À faire      |
| 7. Application de bureau  | Coque Electron                                                                          | À faire      |

Chaque phase est validée avant de passer à la suivante.

## 12. Risques identifiés

| Risque                                                                             | Parade                                                                                                         |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Envoi réel accidentel                                                              | Mode simulation, validation humaine, e-mails intégrés en dernier                                               |
| Droits et légalité (doublage de vidéos de tiers, voix et image, RGPD, prospection) | Échantillons privés, désinscription, conservation limitée ; vérifier les conditions de HeyGen avant la phase 6 |
| Quotas de l'API YouTube                                                            | Mise en cache, synchronisation espacée                                                                         |
| Coût de HeyGen                                                                     | Plafond de dépenses, coût par échantillon, génération seulement après approbation                              |
| Délivrabilité des e-mails                                                          | Domaine dédié, SPF/DKIM/DMARC, faible volume                                                                   |
| Performance 3D                                                                     | Low-poly, instanciation, ombres limitées, rendu à la demande                                                   |
| Erreurs de l'IA                                                                    | Sorties validées par Zod, validation humaine                                                                   |
| Logique dispersée dans n8n                                                         | Le backend décide, n8n exécute                                                                                 |

## 13. Journal des décisions techniques

| Date       | Décision                                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 29/10/2026 | **TypeScript 6.0** et non 7.0 : l'outil de lint (typescript-eslint) ne prend pas encore en charge TypeScript 7.                                                                                                   |
| 29/10/2026 | **Prisma 7.10** (dernière version stable) et non 8.0, encore en préversion. Prisma 7 impose un adaptateur de pilote : `@prisma/adapter-mariadb`, compatible MySQL.                                                |
| 29/10/2026 | Le serveur est exécuté directement en TypeScript avec **tsx** (pas d'étape de compilation). La compilation sera ajoutée en phase 7 pour Electron.                                                                 |
| 29/10/2026 | Le paquet `@agency/shared` est consommé en source TypeScript, sans étape de build.                                                                                                                                |
| 29/10/2026 | **n8n** n'est pas encore dans `docker-compose.yml` : il sera ajouté en phase 6, quand il servira.                                                                                                                 |
| 29/10/2026 | L'utilisateur MySQL `agency` a tous les droits **en local** : Prisma Migrate doit pouvoir créer une base temporaire de comparaison.                                                                               |
| 29/10/2026 | Phase 1 : les sept statuts sont conservés. Le résultat de validation et les tentatives sont des **champs** de la mission, pas de nouveaux statuts.                                                                |
| 29/10/2026 | Les règles du cycle de vie sont dans `packages/shared` (source unique). Le serveur les applique ; l'interface pourra s'en servir pour l'affichage.                                                                |
| 29/10/2026 | Colonnes `status` / `room` / `action` en chaînes plutôt qu'en enums Prisma, pour ne pas dupliquer les listes du paquet partagé.                                                                                   |
| 29/10/2026 | Ajout de `pending → blocked` (absent du plan initial) : une mission peut être bloquée avant son démarrage (données manquantes).                                                                                   |
| 29/10/2026 | Refus d'un résultat = `cancelled` + `validationOutcome = rejected` ; demande de modifications = retour en `in_progress`.                                                                                          |
| 29/10/2026 | Historique protégé par des déclencheurs MySQL (aucune modification ni suppression possible).                                                                                                                      |
| 29/10/2026 | Contrôle de concurrence optimiste par `version` plutôt que par verrous : simple, et suffisant pour un usage mono-utilisateur.                                                                                     |
| 29/10/2026 | Prisma 7 ne régénère plus le client après une migration : `npm run db:migrate` enchaîne désormais `migrate dev` et `generate`.                                                                                    |
| 29/10/2026 | Phase 2 : libellés alignés sur le cahier des charges (« Mon bureau », « Salle commerciale », « Salle de suivi ») ; identifiants inchangés.                                                                        |
| 29/10/2026 | Mobilier construit en formes simples dans le code plutôt qu'en modèles 3D téléchargés : aucun fichier lourd, couleurs maîtrisées, aménagement vérifiable par des tests.                                           |
| 29/10/2026 | Étiquettes en HTML maison plutôt que le composant `Html` de drei, qui perdait une étiquette avec React 19 en mode développement.                                                                                  |
| 29/10/2026 | Caméra : `camera-controls` (fourni avec drei) avec `SCREEN_PAN` (déplacement sur le sol) ; cadrages calculés par `cameraMath.ts`, car son `fitToBox` réaligne la caméra sur les axes et casse la vue isométrique. |
| 29/10/2026 | Ombres en `PCFShadowMap` (`shadows="percentage"`) : `PCFSoftShadowMap` a été retiré de Three.js.                                                                                                                  |
| 29/10/2026 | Outil de test `window.__agencyProbe`, présent **uniquement en développement**, pour les tests automatisés dans le navigateur.                                                                                     |
