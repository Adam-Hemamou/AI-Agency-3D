# Architecture — AI Agency 3D

> Document de référence, validé le 29/10/2026.
> Il décrit **ce qui est décidé**. Toute évolution importante doit y être reportée (section « Journal des décisions »).

## 1. Vision

Application de bureau à usage personnel représentant une agence commerciale virtuelle en 3D (vue isométrique).
Des agents IA prospectent des créateurs de contenu, évaluent leur potentiel international et leur proposent
un service de traduction et de doublage vidéo (HeyGen). Les décisions importantes restent validées par l'utilisateur.

**Règle du prototype : ni dépense ni envoi réels.** Les agents peuvent lire des données publiques par les API
officielles (YouTube Data API) ; les e-mails et traitements HeyGen restent simulés, puis seront intégrés un par un,
chacun avec une autorisation humaine préalable.

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
| `release`               | `in_progress`                                                        | `pending`             | **Système uniquement**, voir ci-dessous         |

**Remise en attente (`release`, Phase 2)** : après l'échec d'une exécution, uniquement par le **système**, avec un motif,
et refusée (409) si la mission a déjà produit un effet depuis son démarrage (analyse, production, décision, activité
du dossier qui la cite, ou résultat transmis) ou s'il ne reste aucune tentative : la mission doit alors être bloquée.
Vérifiée sous verrou de la mission, comme les écritures d'agents qui la citent. Une mission prise par un agent (libre
à l'origine) redevient libre ; une mission attribuée à la création garde son agent. Jamais proposée dans l'interface
(`SYSTEM_MISSION_ACTIONS`, exclue de `getAvailableActions`).

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
- **Origine des actions** : déterminée par le serveur pour chaque requête (voir [§ 7 quater](#7-quater-identité-et-authentification-des-agents)) :
  une clé d'agent valide → cet agent ; aucune clé → l'utilisateur (`user` / `owner`). Le système agit avec
  l'identité `system`.
- **Attribution (phase 1 agents)** : un agent qui démarre une mission libre la **prend** (`agent_id` renseigné dans
  la même écriture, tracé dans l'événement `start`). Le contrôle « mission de l'agent, ou libre de sa salle » est fait
  sur la mission lue **dans** la transaction ; la condition de version garantit qu'un seul agent l'obtient (l'autre
  reçoit 403 ou 409). Une mission libre ne peut qu'être démarrée par un agent. À la création, `agentId` doit avoir le
  format `agent-…` et désigner un agent existant (400 sinon).
- **Missions interrompues** : une mission `in_progress` sans **aucune activité** depuis `MISSION_STALE_MINUTES`
  (60 par défaut, .env) passe en `blocked`, au nom du système, code `INTERRUPTED` (`missions.recoverStale`,
  lancé au démarrage puis toutes les 5 minutes ; désactivé en démonstration). Activité = une transition de la mission,
  ou une analyse, production, décision ou activité du dossier qui la cite : un agent engagé dans un long traitement
  signale qu'il avance en ajoutant une activité liée à la mission. Le motif liste les effets déjà enregistrés depuis le
  démarrage. **Jamais de retour automatique en `pending`** : l'utilisateur débloque (nouvelle tentative, limitée par
  `maxAttempts`) ou annule. Chaque blocage est revérifié dans sa transaction : si l'agent agit au même moment, une
  seule des deux actions est enregistrée. La récupération verrouille la mission (`FOR UPDATE`) avant toute lecture,
  et une écriture d'agent qui la cite la lit avec un verrou partagé (`FOR SHARE`) : si l'écriture passe la première,
  la récupération la voit et ne bloque pas ; sinon l'écriture trouve la mission bloquée et est refusée (409). Un effet
  enregistré au même moment n'est donc jamais ignoré.

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

`agent_id` n'a pas de clé étrangère vers `agents` : des missions existantes citent des agents qui n'ont pas
(encore) d'identité enregistrée. Pour les **nouvelles** missions, le moteur vérifie que l'agent existe.

### CRM : un dossier unique par prospect (migration `20261104120000_prospect_dossiers`)

Un prospect = **un seul dossier**, enrichi salle après salle. Les missions de toutes les salles y sont
rattachées (`missions.prospect_id`, facultatif : les missions existantes restent valides).

| Table                  | Contenu                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prospects`            | Identité, chaîne (`youtube_channel_id` unique : pas de doublon), statistiques **avec source et date**, contact, découverte, étape (`stage`), relation, priorité, `do_not_contact`, prochaine action, `is_demo`, `version` |
| `prospect_analyses`    | Analyses versionnées, jamais modifiées ; chaque information est un **fait vérifié** (sourcé), une **observation** ou une **hypothèse IA** ; score calculé à partir de critères pondérés                                   |
| `prospect_productions` | Extraits, doublages, propositions, e-mails ; versionnés, statut propre                                                                                                                                                    |
| `prospect_decisions`   | Décisions humaines (prospect validé / refusé / réanalyse, e-mail validé / refusé / à modifier)                                                                                                                            |
| `prospect_messages`    | E-mails envoyés et reçus ; `delivery = simulated` tant qu'aucun envoi réel n'existe                                                                                                                                       |
| `prospect_events`      | Timeline du dossier, **inaltérable en base** (mêmes triggers que `mission_events`)                                                                                                                                        |

Règles (`packages/shared/src/prospects.ts`) : étapes et transitions autorisées, salle de chaque étape,
statuts de relation, blocage des relances (`canSendFollowup` : jamais si refus ou « ne plus contacter »).
Seul le service `apps/server/src/prospects/prospectService.ts` écrit dans ces tables ; chaque décision fait
évoluer la mission **via le moteur de missions**, dans la même transaction que le dossier.

**Missions créées par le CRM.** Un prospect créé par un agent est rattaché à sa **mission de recherche en cours**
(`search_creators`, salle de prospection, attribuée à l'agent, en cours, exécution active ; vérifiée et verrouillée
dans la transaction) : l'événement « Prospect découvert » la cite, et **aucune mission n'est créée** (une mission de
découverte attribuée à l'agent passerait avant ses recherches à la prise suivante). La mission `discover_creator`
ne subsiste que dans le scénario de démonstration. Le passage en analyse crée la mission libre de l'Analyste.
La mission de revue de **Mon bureau** (`review_prospect`) est démarrée puis soumise par le système dès sa création
(`DIRECT_HUMAN_REVIEW_ROOMS`, résultat : version et score de la dernière analyse) : elle attend la décision de
l'utilisateur sans étape manuelle et n'est visible d'aucun agent. La mission de validation des e-mails, elle, reste
démarrée par un agent (rédaction ou vérification), qui la soumet.

**Coordonnées.** Une seule règle pour la création et l'enrichissement : enregistrer, modifier ou effacer une
coordonnée (`contactEmail`, `contactName`, `contactSource`) exige `prospects:read_contact`. Le rôle recommandé
du prospecteur ne la contient pas (informations publiques uniquement) : elle est accordée explicitement.

« Nouvelle analyse demandée » : la mission de revue de Mon bureau est close (décision `reject` avec motif), le
prospect n'est **pas** refusé, une nouvelle mission d'analyse est créée avec la consigne, et l'ancienne
analyse est conservée. Le motif de refus d'un prospect est facultatif (un motif par défaut est enregistré
sur la mission pour la traçabilité).

### Agents IA (migration `20261105100000_agent_identities`)

| Table            | Contenu                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `agents`         | Identifiant (`agent-…`, contrainte `CHECK` en base), nom, description, salle, statut (`active` / `disabled`)                              |
| `agent_api_keys` | Clés : partie publique (`prefix`), **empreinte SHA-256** (jamais la clé), libellé, création, expiration, dernière utilisation, révocation |

Déclencheurs MySQL : une clé n'est **jamais supprimée** ; son agent, sa partie publique et son empreinte ne changent
jamais ; une clé révoquée **ne peut pas être réactivée**.

Migration `20261105140000_agent_api` :

| Table               | Contenu                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `agent_permissions` | Permissions accordées à chaque agent (`AGENT_PERMISSIONS`) ; aucune par défaut                                                |
| `agent_requests`    | Écritures des agents : clé d'idempotence (unique par agent), empreinte de la requête, réponse enregistrée. Conservées 7 jours |

Migration `20261107090000_agent_profiles` (voir [§ 7 septies](#7-septies-profils-ia-et-prompts-versionnés)) :

| Table            | Contenu                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_profiles` | Profil IA (une ligne au plus par agent) : rôle, modèle, paramètres d'inférence bornés (`CHECK`), version active du prompt (clé étrangère) |
| `agent_prompts`  | Versions du prompt système (`agent_id`, `version`), **inaltérables en base** (triggers : ni modification, ni suppression)                 |

Migrations `20261107140000_agent_runs` et `20261107160000_agent_runs_started_at_index` (Phase 2, étape 2 ;
contrat : `packages/shared/src/agentRuns.ts`) :

| Table        | Contenu                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_runs` | Une exécution = une tentative de travail d'un agent sur une mission : tentative, statut, exécution n8n, **version du prompt** (clé étrangère) et **copie des paramètres** utilisés, début, signal de vie, fin, cause d'échec, sortie brute (rejet), jetons et durée |

Garanties assurées par la base : **une seule exécution `started` par mission** (colonne générée `active_mission_id` +
index unique) ; une seule prise de mission par exécution n8n et par agent ; statuts limités à `AGENT_RUN_STATUSES` ;
date de fin présente si et seulement si l'exécution est terminée ; identité non modifiable ; **exécution terminée
inaltérable** ; aucune suppression. Statuts : `started`, `succeeded`, `failed` (mission bloquée), `released` (mission
remise en attente), `abandoned` (récupération), `stopped` (pause, blocage ou annulation). Signal de vie attendu de
n8n toutes les 5 minutes (`AGENT_HEARTBEAT_INTERVAL_SECONDS`). Seul le service des exécutions
(`apps/server/src/agents/runService.ts`) écrit dans cette table.

**Prise de mission** (`POST /api/agent/runs/claim`, étape 2d), corps `{ n8nExecutionId }`, en une transaction :

1. arrêt d'urgence revérifié ;
2. **idempotence** : la même exécution n8n (même agent) renvoie la même exécution (200, `replayed: true`), sans
   rien démarrer ; envoyée plusieurs fois en même temps, une seule prise est enregistrée ;
3. **prompt actif obligatoire** : sinon 409 `AGENT_PROMPT_MISSING` ;
4. **choix de la mission**, selon la règle de visibilité (`canAgentSeeMission`) : d'abord **sa mission à reprendre**
   après une demande de modification (en cours, sans exécution active : `resumed: true`, pas de nouvelle tentative),
   sinon **ses missions en attente**, puis **les missions libres de sa salle** (jamais pour un agent sans salle), par
   priorité décroissante puis ancienneté, en ignorant les missions sans tentative restante ;
5. **verrouillage sans attente** : la liste ordonnée des candidates est lue sans verrou, puis chaque candidate est
   verrouillée **seule, par sa clé**, avec `FOR UPDATE SKIP LOCKED`, toutes les conditions étant revérifiées. Une
   lecture verrouillante avec `ORDER BY` verrouillerait toutes les lignes examinées : une seule prise bloquerait la
   salle entière ;
6. **démarrage par le moteur de missions** (mêmes règles que les transitions : une mission libre est attribuée à
   l'agent), puis création de l'exécution (version du prompt, copie des paramètres, signal de vie initial) ;
7. interblocage MySQL : la transaction, annulée en entier, est rejouée (3 essais au plus).

Réponses : 201 (prise), 200 (même exécution n8n), **204 sans corps** (rien à faire). Permission `missions:update`.
Les deux index uniques (exécution en cours par mission, exécution n8n par agent) garantissent en dernier recours
qu'aucun doublon n'est possible.

**Signal de vie** (`POST /api/agent/runs/:id/heartbeat`, étape 2e), corps `{ n8nExecutionId }` : met à jour
`heartbeat_at`. Refusé (403) pour l'exécution d'un autre agent ou prise par une autre exécution n8n ; 404 si elle
n'existe pas ; 409 si l'exécution est terminée ou si sa mission n'est plus en cours. Verrou de l'exécution : un signal
simultané à un échec passe avant ou après, jamais après la clôture.

**Échec** (`POST /api/agent/runs/:id/failure`, étape 2e), corps `{ n8nExecutionId, code, message, rawOutput?,
promptTokens?, outputTokens?, llmMs? }` : mêmes contrôles d'identité et de propriété, puis le CRM décide seul :

- **aucun effet** depuis le démarrage et **une tentative restante** → `release` par le système (mission en attente ;
  libre si elle avait été prise), exécution `released` ;
- **sinon** → `block` par le système (code d'échec et motif enregistrés sur la mission), exécution `failed`.

L'exécution est close dans la même transaction (code, message, sortie brute, jetons, durée). Verrous dans l'ordre
mission puis exécution, comme la prise de mission ; la récupération et les écritures qui citent la mission
verrouillent aussi la mission : un échec simultané d'une transition, d'une écriture ou de la récupération passe avant
ou après, jamais entre les deux. Le même échec renvoyé par n8n ne change rien (`replayed: true`). La mission de
l'exécution est lue avant la transaction (elle ne change jamais) : les premières instructions de la transaction sont
les verrous, et toutes les lectures voient le dernier état enregistré.

**Clôture automatique** (étape 2f) : quand une mission quitte `in_progress`, le moteur de missions clôt son exécution
active **dans la même transaction** que la transition (même horodatage) : terminée ou soumise à validation →
`succeeded` ; remise en attente → `released` ; bloquée par la récupération (`INTERRUPTED`) → `abandoned` ; mise en
pause, bloquée ou annulée autrement → `stopped` (un blocage garde son code et son motif sur l'exécution). Un échec
signalé clôt lui-même son exécution (avec ses mesures) juste avant la transition. Si la transaction échoue, rien n'est
écrit : jamais d'exécution active pour une mission qui n'est plus en cours.

**Démarrer et reprendre passent par la prise de mission** : la route `POST /api/agent/missions/:id/transitions`
refuse `start` et `resume` aux agents (403, `CLAIM_ONLY_MISSION_ACTIONS`) ; un agent ne travaille jamais sans
exécution. L'utilisateur garde ces actions sur ses propres routes. `claim` reprend toute mission **en cours, à
l'agent, sans exécution active** (demande de modification d'abord, puis mission démarrée ou reprise par
l'utilisateur pour cet agent) avec une **nouvelle exécution** ; les précédentes restent dans l'historique.

**Signal de vie et récupération** (étape 2g) : une mission en cours dont l'exécution active a envoyé un signal de vie
depuis moins de `MISSION_STALE_MINUTES` (ou, sans aucun signal, a démarré depuis moins longtemps) n'est **jamais**
récupérée : elle n'est même pas candidate (une mission longuement maintenue en vie n'empêche pas l'examen des autres).
Au-delà, la récupération bloque la mission (`INTERRUPTED`, motif avec la date du dernier signal) et clôt
l'exécution en `abandoned`, dans la même transaction. Verrous : mission **puis** exécution active, avant toute
lecture ; un signal en cours (qui verrouille l'exécution) se termine d'abord et est vu, un signal arrivé après
trouve l'exécution close (409). Mission sans exécution active : comportement inchangé (activité liée et date de
dernière modification). Pendant l'arrêt d'urgence, les signaux sont refusés mais la récupération continue : les
exécutions sont closes au seuil, jamais laissées actives. Exécutions incohérentes (actives alors que la mission
n'est plus en cours, après une intervention directe en base) : closes en `abandoned`, code `ORPHANED_RUN`, à
chaque passage (`closeOrphanRuns`), sans toucher à la mission. Une exécution terminée n'est jamais modifiée.

**Consultation** (étape 2h, lecture seule, aucune route de modification ni de suppression) :

- `GET /api/agent/runs/:id` (agent, `missions:read`) : une de **ses** exécutions et le résumé de sa mission
  (identifiant, statut, tentative, version du prompt, paramètres enregistrés, dates de début, de dernier signal et
  de fin, échec éventuel, jetons et durée, exécution n8n). 403 pour celle d'un autre agent (rien n'en est
  renvoyé), 404 si elle n'existe pas.
- `GET /api/runs` (utilisateur, `apps/server/src/routes/runs.ts`) : journal paginé (`limit` ≤ 200, `offset`),
  filtres `agentId`, `missionId`, `status` (un ou plusieurs), période `from` (incluse) / `to` (exclue) sur la
  date de début, tri chronologique `sort=recent` (défaut) ou `oldest`. Chaque ligne : l'exécution, le nom de
  l'agent, le résumé de la mission, la durée et `hasRawOutput`. Refusé aux agents (liste blanche) et jamais exposé
  par l'écoute Tailscale. Trois requêtes quelle que soit la page (page avec jointures, total, sorties brutes
  présentes) ; index `(started_at, id)` pour le tri (migration `20261107160000_agent_runs_started_at_index`).
- **Jamais** la sortie brute du modèle (seul `hasRawOutput` indique qu'elle existe ; son contenu n'est même pas lu),
  ni le texte du prompt, ni aucune clé.

## 7 ter. API du CRM

Contrat : `packages/shared/src/prospectApi.ts`. Toutes les actions renvoient le dossier complet à jour.

| Méthode et route                               | Rôle                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/prospects`                           | Liste (filtres `stage`, `search`)                                                                |
| `GET /api/prospects/:id/dossier`               | Dossier complet : prospect, missions, analyses, productions, décisions, messages, timeline       |
| `POST /api/prospects/:id/decisions`            | Mon bureau : `approve`, `reject` (motif facultatif), `request_reanalysis` (consigne facultative) |
| `POST /api/prospects/:id/email/decisions`      | Validation des e-mails : `approve`, `reject`, `request_changes` (motif obligatoire)              |
| `POST /api/prospects/:id/email/drafts`         | Modifier le brouillon (crée une nouvelle version)                                                |
| `POST /api/prospects/:id/email/simulated-send` | Enregistre un envoi **simulé** (refusé hors mode simulation)                                     |
| `POST /api/prospects/:id/replies`              | Enregistrer une réponse reçue                                                                    |
| `POST /api/prospects/:id/followups`            | Relance **simulée** (refusée si le prospect ne veut plus être contacté)                          |
| `PATCH /api/prospects/:id/followup`            | Statut de la relation, prochaine action, priorité, « ne plus contacter »                         |
| `POST /api/prospects/:id/notes`                | Note interne                                                                                     |

`GET /api/missions` renvoie aussi le résumé du prospect de chaque mission et accepte `?prospectId=`.
Les écritures du pipeline (créer un prospect, ajouter une analyse ou une production, changer d'étape) sont
des méthodes du service, prêtes pour les agents et n8n, sans route HTTP pour l'instant.

### Environnement de démonstration

`npm run demo:setup` recrée la base `ai_agency_demo` (nom obligatoirement suffixé `_demo`) et y joue un
scénario fictif **à travers les vrais services** (moteur de missions compris, horloge injectée pour dater
les étapes). `npm run dev:demo` lance l'API sur le port 3101 et l'interface sur le port 5174 : la base
réelle n'est jamais ouverte et la démo force le mode simulation.

## 7 quater. Identité et authentification des agents

Étape 1 de la préparation à n8n. **Aucun agent réel n'est connecté** et n8n n'est pas branché.

**Identités.** Chaque agent a un identifiant qui commence obligatoirement par `agent-` (schéma partagé
`agentIdSchema` + contrainte en base). L'humain est `owner`. Un acteur n'est reconnu comme humain que s'il est de
type `user` **et** que son identifiant n'est pas celui d'un agent (`isHumanActor`, `apps/server/src/auth/actors.ts`).

**Clés API.** Format `agk_<12 caractères publics>_<secret de 256 bits>`. La clé complète n'est montrée **qu'une fois**,
à sa création (réponse `Cache-Control: no-store`) ; seule son empreinte est stockée, et la comparaison se fait en
temps constant. Une clé peut expirer ou être révoquée (définitivement) ; désactiver un agent bloque toutes ses clés.

**Identification de chaque requête** (`identifyRequest`, `apps/server/src/auth/requestActor.ts`), appliquée à toutes
les routes :

| La requête présente…                                                                                    | Auteur retenu                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `Authorization: Bearer agk_…` valide                                                                    | L'agent propriétaire de la clé |
| Toute autre identification (clé fausse, révoquée, expirée, agent désactivé, autre schéma, `X-Api-Key`…) | **Refus 401**, jamais l'humain |
| Aucune identification                                                                                   | L'utilisateur (`owner`)        |

Le corps et les paramètres de la requête ne jouent aucun rôle dans l'identité.

**Ce qu'un agent peut faire** (`agentAccessGuard`, `apps/server/src/auth/agentAccess.ts`) : **liste blanche**, où chaque
route est associée à la permission qu'elle exige (voir [§ 7 quinquies](#7-quinquies-api-des-agents)). Toute autre route,
y compris une route ajoutée plus tard, lui est refusée (403 `FORBIDDEN_ACTOR`) tant qu'elle n'est pas ajoutée explicitement.

**Actions réservées à l'humain**, refusées aussi **dans les services** (`assertHumanActor`), quelle que soit la route :
décisions de validation des missions, décisions sur un prospect (Mon bureau), décisions sur un e-mail, **envoi d'un
e-mail et relance**, gestion des agents, de leurs clés et de leurs permissions (un agent ne peut ni se créer de clé, ni
se réactiver, ni changer de salle, ni s'accorder de permission).

| Méthode et route                          | Rôle                                                                                  | Qui    |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| `GET /api/agents`                         | Liste des agents et de leurs clés (sans secret)                                       | Humain |
| `POST /api/agents`                        | Créer un agent (`id`, `name`, `description?`, `room?`, `permissions?`)                | Humain |
| `GET /api/agents/:id`                     | Détail d'un agent                                                                     | Humain |
| `PATCH /api/agents/:id`                   | Nom, description, salle, statut (`active` / `disabled`), permissions (liste complète) | Humain |
| `POST /api/agents/:id/keys`               | Nouvelle clé (`label?`, `expiresAt?`) : **affichée une seule fois**                   | Humain |
| `POST /api/agents/:id/keys/:keyId/revoke` | Révoquer une clé, définitivement                                                      | Humain |
| `GET /api/agents/me`                      | Identité associée à la clé présentée                                                  | Agent  |

**Limite connue.** L'interface humaine n'est pas encore authentifiée : une requête **sans clé** venant de la machine
locale est attribuée à l'utilisateur. Un agent qui présente sa clé ne peut jamais être pris pour l'humain, mais un
programme local qui n'en présente aucune le serait. L'API n'écoute que sur `127.0.0.1` ; avant de connecter n8n, il
faudra authentifier l'utilisateur (session) ou donner aux agents un accès réseau distinct qui exige une clé.

## 7 quinquies. API des agents

Étape 2 de la préparation à n8n : les agents authentifiés travaillent dans le CRM **par les mêmes services** que
l'interface (le CRM reste la source de vérité). n8n n'est pas branché ; aucune API payante n'est appelée.
Contrat : `packages/shared/src/agentApi.ts` ; règles : `packages/shared/src/agentPolicy.ts` ; routes :
`apps/server/src/routes/agentApi.ts`.

**Permissions.** Accordées une par une par l'utilisateur ; un nouvel agent n'en a aucune. Elles sont relues à chaque requête.

| Méthode et route                                         | Permission          | Rôle                                                                                  |
| -------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/agent/profile`                                 | aucune              | Son profil IA : rôle, paramètres du modèle, prompt actif                              |
| `GET /api/agent/capabilities`                            | aucune              | Actions externes permises (lecture publique, dépense, envoi), à lire par n8n          |
| `GET /api/agent/schemas`, `GET /api/agent/schemas/:name` | aucune              | Schémas JSON (format Ollama, corps des requêtes), issus des schémas Zod               |
| `POST /api/agent/runs/claim`                             | `missions:update`   | Prend sa prochaine mission et crée l'exécution (201, 200 rejouée, 204 rien)           |
| `POST /api/agent/runs/:id/heartbeat`                     | `missions:update`   | Signal de vie de son exécution en cours                                               |
| `POST /api/agent/runs/:id/failure`                       | `missions:update`   | Échec de son exécution : remise en attente sans effet, sinon blocage                  |
| `GET /api/agent/runs/:id`                                | `missions:read`     | Une de ses exécutions et sa mission (lecture seule)                                   |
| `GET /api/agent/prospects/lookup`                        | `prospects:read`    | Doublons : `youtubeChannelId`, `channelHandle`, `channelUrl`, `contactEmail`          |
| `GET /api/agent/prospects/:id/context`                   | `prospects:read`    | Dossier complet + ce que l'agent peut faire maintenant                                |
| `POST /api/agent/prospects`                              | `prospects:create`  | Créer un prospect dans SA mission de recherche en cours (`missionId`) ; doublon : 409 |
| `PATCH /api/agent/prospects/:id`                         | `prospects:enrich`  | Compléter les informations (sources obligatoires)                                     |
| `POST /api/agent/prospects/:id/analyses`                 | `analyses:write`    | Ajouter une analyse ; le score est calculé par le serveur                             |
| `POST /api/agent/prospects/:id/productions`              | `productions:write` | Ajouter une production (extrait, doublage, proposition, brouillon d'e-mail)           |
| `POST /api/agent/prospects/:id/stage`                    | `stages:advance`    | Faire avancer le prospect (étapes autorisées uniquement)                              |
| `POST /api/agent/prospects/:id/events`                   | `events:write`      | Ajouter une activité à l'historique (type `agent_activity`)                           |
| `POST /api/agent/missions/:id/transitions`               | `missions:update`   | Mettre en pause, soumettre, terminer, bloquer (démarrer : `runs/claim`)               |
| `GET /api/agent/missions`, `GET /api/agent/missions/:id` | `missions:read`     | Missions (sans historique) : les siennes et les libres de sa salle                    |

**Lecture filtrée (lot D).** Les agents ne lisent **que** par `/api/agent/…` : toutes les routes de l'interface leur
sont fermées, même en lecture (elles renvoient le dossier complet et l'historique des missions, qui contient les motifs
des validations). Tout dossier renvoyé à un agent (contexte, réponse d'une écriture, réponse rejouée) passe par une
seule fonction, `toAgentDossier` (`apps/server/src/agents/agentView.ts`), selon ses permissions **actuelles** :

| Permission               | Donne accès à                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `prospects:read`         | Chaîne, statistiques publiques, découverte, étape, priorité, « ne plus contacter » (oui/non), missions  |
| `prospects:read_contact` | E-mail, nom et source du contact (aussi exigé pour les modifier et pour chercher un doublon par e-mail) |
| `analyses:read`          | Analyses et scores ; consigne d'une nouvelle analyse                                                    |
| `productions:read`       | Extraits vidéo et doublages                                                                             |
| `proposals:read`         | Propositions et e-mails ; consigne de modification d'un e-mail                                          |
| `messages:read`          | E-mails échangés (réponses reçues marquées `untrusted: true`), statut de la relation, prochaine action  |
| `decisions:read`         | Motifs des décisions humaines, motif de « ne plus contacter » — **autorisation explicite**              |
| `notes:read`             | Notes internes — **autorisation explicite**                                                             |

Ajouter une production exige de pouvoir lire son type. Les parties masquées sont absentes du dossier et listées dans
`hidden`. Un type d'événement nouveau est invisible tant qu'il n'est pas classé. Le détail des changements d'étape
décidés par l'utilisateur et les coordonnées dans l'historique d'enrichissement sont retirés sans la permission voulue.

**Rôles** (`AGENT_ROLE_PERMISSIONS`, permissions recommandées que l'utilisateur attribue explicitement) :

| Rôle        | Lecture                                                              | Écriture                                                         |
| ----------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Prospecteur | publiques                                                            | créer, enrichir, étapes, activité, missions                      |
| Analyste    | publiques, analyses                                                  | analyses, enrichir, étapes, activité, missions                   |
| Producteur  | publiques, productions du doublage                                   | productions du doublage, étapes, activité, missions              |
| Commercial  | publiques, coordonnées, analyses, doublages, propositions et e-mails | propositions et brouillons d'e-mails, étapes, activité, missions |
| Suivi       | publiques, coordonnées, propositions et e-mails, échanges            | activité, missions                                               |

Aucun rôle n'a `decisions:read` ni `notes:read`.

**Règles imposées aux agents** (serveur, dans la transaction du service) :

- **Étapes** : prospection → analyse, analyse → à valider, doublage → proposition, proposition → validation e-mail.
  Valider, refuser, renvoyer en analyse, valider un e-mail (passage au suivi), convertir et archiver restent humains.
  Le refus est appliqué dans `moveToStage` pour tout auteur de type agent. La mission de la nouvelle salle est créée
  par le serveur ; celles de « à valider » et « validation e-mail » **exigent la validation humaine**.
- **Salle** : un agent rattaché à une salle ne fait avancer que les dossiers de sa salle et n'agit que sur les missions de sa salle.
- **Missions** (`canAgentSeeMission`, `packages/shared/src/agentPolicy.ts`, règle unique pour la liste, le détail,
  le dossier et les transitions) : un agent rattaché à une salle voit ses missions et les missions **libres de sa salle** ;
  un agent **sans salle** ne voit que ses missions et ne peut prendre aucune mission libre. Jamais les missions d'un autre
  agent, y compris dans le dossier. Annuler et débloquer sont refusés **par le moteur**.
- **Mission citée** par une analyse, une production ou une activité (`missionId`) : pour un agent, elle doit concerner
  le dossier, **lui être attribuée**, être visible par lui (sa salle) et être **`in_progress`** (403 sinon pour
  l'attribution, 409 pour le statut). L'utilisateur et le système gardent la seule vérification du dossier.
- **Analyses** : à l'étape d'analyse uniquement.
- **Productions** : extrait et doublage à l'étape doublage (`draft`, `generated`, `failed`) ; proposition à l'étape
  proposition et e-mail aux étapes proposition et validation e-mail (`draft`, `pending_review`). Jamais `approved`,
  `sent`, `rejected`… Pour un e-mail, ce refus est aussi appliqué **dans le service** à tout auteur non humain.
- **E-mails** : aucune route d'agent n'envoie ; `simulateSend` et `sendFollowup` refusent tout auteur non humain.
- **Enrichissement** : jamais l'étape, la relation, « ne plus contacter », la prochaine action ni `isDemo` ; l'identifiant
  YouTube ne peut être renseigné que s'il manque ; chaque champ modifié est historisé (ancienne / nouvelle valeur).
- **Attribution** : chaque écriture porte l'identité de l'agent authentifié ; `discovery.discoveredBy` est fixé par le serveur.
- **Adresses web** (chaîne, avatar, vidéo, démonstration, sources) : `http(s)` uniquement (`httpUrlSchema`). L'interface
  n'affiche un lien cliquable que pour une telle adresse (`ExternalLink`) : un lien `javascript:` déposé par un agent
  ne peut pas agir au nom de l'utilisateur.

**Doublons.** Avant toute création : même identifiant YouTube, même nom de chaîne (`@nom`, `nom`, casse ignorée,
ou nom tiré de l'adresse `…/@nom`) ou même adresse de chaîne (`www.`, `m.`, paramètres et `/` final ignorés) → 409
`ALREADY_EXISTS` avec la référence du dossier existant. L'e-mail de contact est signalé par la recherche mais ne bloque
pas la création (une agence peut gérer plusieurs créateurs). Un agent doit fournir au moins un identifiant de chaîne.

**Garantie en base (lot B).** Colonnes `channel_handle_key` et `channel_url_key` **uniques**, calculées par
`channelHandleKey` / `channelUrlKey` (paquet partagé) à la création et à l'enrichissement : même une écriture qui
contournerait le service est refusée. L'identifiant YouTube était déjà unique.

**Numérotation (lot B).** `P-AAAA-NNNN`, compteur par année (`prospect_counters`), réservé en **première instruction**
de la transaction de création : la ligne du compteur reste verrouillée jusqu'à la fin, les créations simultanées passent
l'une après l'autre, et la recherche de doublons qui suit voit toutes les créations terminées. Le compteur ne recule
jamais derrière un numéro existant. En dernier recours (index unique, interblocage MySQL), la création est rejouée
jusqu'à 5 fois.

**Migration sur une base existante.** La migration remplit compteurs et clés des dossiers existants avec des règles SQL
équivalentes (vérifiées par `backfillMigration.int.test.ts`). Si des doublons existent déjà, **rien n'est supprimé** :
le plus ancien dossier reçoit la clé, les autres restent sans clé. `npm run db:check-duplicates` (lecture seule) les
liste ; à lancer **avant** la migration.

**Requêtes répétées (lot C).** Toute écriture d'un agent exige `Idempotency-Key` (8 à 128 caractères). La clé est
enregistrée **dans la transaction de l'écriture**, en première instruction (`TransactionHook`, passé aux services) :

| Situation                                             | Résultat                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Écriture réussie                                      | Clé et écriture validées ensemble                                                              |
| Échec, ou arrêt brutal du serveur avant la validation | Tout est annulé ensemble : la clé reste libre, la répétition exécute la requête                |
| Arrêt après la validation, avant la réponse           | La répétition renvoie le résultat (`Idempotent-Replayed: true`), rien n'est refait             |
| Même clé, même requête, en même temps                 | La seconde attend la fin de la première (verrou de la base sur la clé), puis reçoit sa réponse |
| Même clé, autre requête                               | 409 `IDEMPOTENCY_CONFLICT`, rien n'est exécuté                                                 |

Aucun état « en cours » ne peut rester bloqué. Une répétition renvoie l'**état actuel** de la ressource écrite (dossier,
ou mission et son événement) : seule la ressource est enregistrée (`agent_requests.resource_type`, `resource_id`,
`event_id`), plus la réponse complète. Les requêtes enregistrées avant le lot C sont encore reconnues (réponse
complète rejouée ; « en cours » signalé par un 409 explicite). Les clés sont propres à chaque agent et conservées 7 jours.
Vérifié par un test qui arrête réellement un processus serveur avant puis après la validation
(`src/agents/idempotency.int.test.ts`).

## 7 sexies. Limites des agents et arrêt d'urgence

Lot E (`apps/server/src/agents/quotas.ts`, `agentControl.ts`, `rateLimit.ts` ; contrat `packages/shared/src/agentLimits.ts`).

**Quotas journaliers GLOBAUX** (tous agents et toutes clés confondus ; jour calendaire à l'heure de Paris) :

| Action                                                    | Limite par jour |
| --------------------------------------------------------- | --------------- |
| Nouveaux prospects (`POST /api/agent/prospects`)          | 10              |
| Enrichissements (`PATCH /api/agent/prospects/:id`)        | 200             |
| Productions (`POST /api/agent/prospects/:id/productions`) | 100             |

- Le compteur (`agent_quota_usage`, une ligne par jour et par action) est incrémenté **dans la transaction de
  l'écriture**, puis relu en lecture verrouillante : les requêtes simultanées comptent l'une après l'autre, la limite
  est exacte.
- Dépassement → 429 `QUOTA_EXCEEDED` (`Retry-After` jusqu'à minuit à Paris) ; la transaction est annulée : **aucune
  donnée ni aucun compteur n'est modifié**. Une écriture qui échoue pour une autre raison n'est pas comptée non plus.
- Une requête déjà traitée reste rejouable (même clé d'idempotence) sans consommer de quota.
- Seules les opérations des agents sont comptées : l'utilisateur, le système et la démo ne le sont pas.
- `GET /api/agent/quotas` (tout agent) et `GET /api/agents/quotas` (utilisateur) : consommation du jour.

**Débit** : 60 requêtes par minute et par agent, toutes routes (429 `RATE_LIMITED`, en mémoire : serveur unique).
**Taille** : 256 ko au plus par requête d'agent (413), 1 Mo pour l'utilisateur.

**Arrêt d'urgence.** Les agents n'agissent que si les deux commandes l'autorisent :

| Commande                                                                      | Effet                                                                                             | Qui peut le lever                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `AGENTS_ENABLED=false` dans `.env`                                            | Arrêt dès le démarrage du serveur                                                                 | Seulement en modifiant `.env` puis en redémarrant       |
| Bouton « Arrêt d'urgence » de l'interface (`POST /api/agents/emergency-stop`) | Arrêt **immédiat**, conservé en base (`agent_switch`) : un redémarrage ne réactive pas les agents | L'utilisateur (bouton « Réactiver », avec confirmation) |

- Contrôlé **avant même de lire la clé** : toute requête qui porte une clé (`Authorization`, ou clé mal placée) reçoit
  503 `AGENTS_DISABLED`, sans aucune lecture ni écriture en base.
- Contrôlé **de nouveau dans la transaction** de chaque écriture : une requête déjà en cours au moment de l'arrêt
  n'écrit rien.
- L'utilisateur garde un accès normal au CRM. Aucun agent ne peut ni déclencher ni lever l'arrêt (route réservée).
- Sans contrôle configuré (`agentControl` absent), les agents sont refusés par défaut. État illisible au démarrage →
  agents arrêtés par précaution.

## 7 septies. Profils IA et prompts versionnés

Phase 2, étape 1 (`apps/server/src/agents/agentProfileService.ts`, contrat : `packages/shared/src/agentProfiles.ts`).
Chaque agent spécialisé a son rôle, son prompt système et ses paramètres ; tous utilisent le même modèle par défaut.

- **Profil absent = valeurs par défaut** (`AGENT_MODEL_DEFAULTS`), adaptées à Qwen3:8b sur Ollama pour des réponses
  JSON : `model: qwen3:8b`, `think: false` (pas de bloc `<think>`), `temperature: 0.2`, `topP: 0.8`, `topK: 20`,
  `numCtx: 8192` (Ollama tronque sans prévenir un prompt plus long que son contexte), `numPredict: 2048`,
  `timeoutSeconds: 180`. Bornes : `AGENT_MODEL_LIMITS`, vérifiées par Zod **et** par la base.
- **Prompts versionnés** : une modification crée la version suivante (numéros consécutifs par agent, ligne de
  l'agent verrouillée pendant l'écriture). Une version n'est **jamais** modifiée ni supprimée. Une nouvelle version
  n'est active que si `activate: true` ; n'importe quelle version existante peut être réactivée (retour arrière).
- **Taille** : 20 000 caractères Unicode au plus, comptés comme MySQL (`CHAR_LENGTH`) : un emoji, un idéogramme ou
  une lettre accentuée comptent pour 1. Colonne `MEDIUMTEXT` utf8mb4 (16 Mo) : 80 000 octets au pire, bien au-delà
  des 65 535 octets d'un `TEXT`.
- **Gestion réservée à l'utilisateur** (service : `assertHumanActor` ; routes refusées aux agents par la liste
  blanche, et jamais accessibles par l'écoute Tailscale). Gestion provisoire par l'API ; écran prévu plus tard.
- **Un agent lit uniquement son profil** : `GET /api/agent/profile`, identité tirée de sa clé (aucun paramètre ne
  permet de lire celui d'un autre), sans permission requise. `prompt: null` tant qu'aucune version n'est active.

| Méthode et route                                 | Rôle                                                               | Accès  |
| ------------------------------------------------ | ------------------------------------------------------------------ | ------ |
| `GET /api/agents/:id/profile`                    | Profil (valeurs par défaut si absent, `isDefault: true`)           | Humain |
| `PATCH /api/agents/:id/profile`                  | Rôle et paramètres ; seuls les champs fournis changent             | Humain |
| `GET /api/agents/:id/prompts`                    | Versions, de la plus récente à la plus ancienne (`active` indiqué) | Humain |
| `POST /api/agents/:id/prompts`                   | Nouvelle version (`systemPrompt`, `note?`, `activate?` = false)    | Humain |
| `GET /api/agents/:id/prompts/:version`           | Une version                                                        | Humain |
| `POST /api/agents/:id/prompts/:version/activate` | Rendre une version active                                          | Humain |
| `GET /api/agent/profile`                         | Son rôle, ses paramètres et son prompt actif (pour n8n)            | Agent  |

## 7 octies. Moteur d'évaluation linguistique (prospecteurs FR → EN et EN → FR)

Phase 1 : moteur seul, sans route, sans base de données (`apps/server/src/language/`, contrat :
`packages/shared/src/languageAssessment.ts`). Point d'entrée unique : `assessCreator()`.

- **Rôles** : n8n orchestre (appels YouTube, Qwen3) ; le CRM calcule, de façon déterministe ; Qwen3 ne produit
  **aucun** score, seulement l'analyse qualitative.
- **Entrée** : réponses **brutes** de la YouTube Data API v3 (`channels.list`, `videos.list`,
  `commentThreads.list`), transmises telles quelles par n8n ; seuls les champs utiles sont lus. Aucune logique
  métier dans n8n.
- **Trois notions séparées** : pays **déclaré** par la chaîne (fait, sans effet sur le score) ; langue du
  **contenu** (vote sur les vidéos récentes : audio déclaré, langue détectée des titres et descriptions) ; langue de
  l'**audience**, jamais connue par l'API publique : seulement des indices (langue des commentaires échantillonnés)
  et des **hypothèses**, toujours accompagnées de la limite `audience_demographics_unavailable`.
- **Niveaux de preuve** (`INSIGHT_KINDS`) : `fact` = champ de l'API lu tel quel (avec sa source) ;
  `observation` = indice calculé ; `hypothesis` = conclusion sur l'audience. Un signal `audience_*` ne peut être
  qu'une hypothèse (vérifié par le code et les tests).
- **Prudence** : le détecteur (français et anglais seulement, sans dépendance) répond `unknown` dès que les données
  manquent ; la langue du contenu est `unknown` sous 3 vidéos exploitables, en cas de conflit majoritaire entre
  langue déclarée et langue détectée, ou sans langue dominante. Une direction n'est évaluée que si le contenu est
  dans sa langue source (ou bilingue) avec une confiance au moins moyenne.
- **Les deux directions sont toujours évaluées** : un créateur bilingue peut être pertinent dans les deux, sans
  second dossier.
- **Score sur 100, méthode versionnée** (`LANGUAGE_METHOD_V1`, `lang-v1`, statut `initial`) : pondérations
  **initiales, à tester sur des données réelles** — commentaires dans la langue cible 30, ouverture visible vers
  la langue cible (traductions, sous-titres) 25, contenu régulier dans la langue source 20, activité récente 15,
  traction 10. Une donnée manquante **exclut** sa composante (jamais comptée zéro) ; `coverage` indique la part
  mesurée ; sous 50 %, pas de score. Toute modification des pondérations ou des seuils crée une nouvelle version.
- **Confiance** (`low`, `medium`, `high`) distincte du score : elle dépend de la langue du contenu, de la taille de
  l'échantillon de commentaires et de la couverture. Un score faible peut être sûr.
- **Commentaires** : leurs textes servent uniquement à compter des langues, en mémoire. Ils ne figurent jamais dans
  le résultat ; une entrée invalide est refusée avec le seul chemin du champ fautif, jamais sa valeur. Ils ne doivent
  pas non plus être journalisés ni enregistrés lorsque le moteur sera exposé par une route (phase suivante).

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
- **Actions externes des agents** (`packages/shared/src/externalActions.ts`, source unique) : elles sont exécutées
  par n8n, jamais par le CRM, qui ne peut donc pas les empêcher techniquement. n8n consulte
  `GET /api/agent/capabilities` avant tout appel externe et s'y conforme :
  - **lecture publique** (`public_read`, sources `PUBLIC_DATA_SOURCES` : YouTube Data API) : autorisée, mode
    simulation compris (gratuite, n'engage ni ne contacte personne) ;
  - **dépense** (`spend`, ex. HeyGen) et **envoi** (`send`, e-mails, relances) : bloqués en mode simulation, et
    toujours refusés hors simulation tant qu'aucune intégration avec autorisation humaine préalable n'existe.
- Tout fournisseur réel côté CRM devra lever `AppError.externalActionBlocked()` tant que l'action est bloquée.
- L'API et MySQL n'écoutent que sur `127.0.0.1` (pas d'accès depuis le réseau). Exception facultative : une
  deuxième écoute de l'API sur l'adresse Tailscale, réservée au VPS et aux routes des agents ([§ 9 ter](#9-ter-accès-du-vps-via-tailscale)).
- **Refus par défaut** : toute requête qui n'est ni celle d'une session humaine valide, ni celle d'un agent muni
  de sa clé, reçoit 401. Seuls `GET /api/health`, `GET /api/auth/session` et `POST /api/auth/login` sont publics.
  Voir [§ 9 bis](#9-bis-authentification-de-lutilisateur).
- Les secrets sont dans `.env`, jamais versionné.
- Clés API des agents : jamais stockées en clair (empreinte SHA-256), montrées une seule fois, révocables.
- Un agent ne peut jamais valider ni décider à la place de l'humain (liste blanche des routes + contrôle dans les
  services). Voir [§ 7 quater](#7-quater-identité-et-authentification-des-agents), y compris sa limite connue.

## 9 bis. Authentification de l'utilisateur

Lot A du renforcement de la sécurité (`apps/server/src/auth/`, migration `20261106100000_security_hardening`).

- **Mot de passe administrateur** : défini uniquement depuis le terminal (`npm run owner:password`, saisie masquée,
  12 caractères minimum). Empreinte **scrypt** salée (`owner_credentials`) ; le mot de passe n'est jamais stocké.
  Le changer ferme toutes les sessions.
- **Session de 12 heures**, fixe : jeton aléatoire de 256 bits dans un cookie `agency_session` **HttpOnly**,
  **SameSite=Strict**, `Path=/api`. Seule l'empreinte du jeton est stockée (`owner_sessions`). Déconnexion =
  session fermée en base.
- **Freinage** des essais : après 5 échecs, délai de 1 min qui double à chaque échec, jusqu'à 15 min (429 + `Retry-After`).
- **Contrôle de l'adresse** (`Host`) : localhost, 127.0.0.1, [::1], plus `ALLOWED_HOSTS`. Bloque le « DNS rebinding ».
- **Contrôle de l'origine** (`Origin`) : toute écriture portée par la session, et la connexion elle-même, doit
  venir exactement de l'interface (même schéma, hôte et port). Une autre page ou une autre application locale ne
  peut donc pas agir avec la session. Le proxy Vite est configuré avec `changeOrigin: false` pour que l'API voie
  l'adresse de l'interface.
- **Identité ambiguë** refusée : une requête qui porte à la fois une clé d'agent et un cookie de session reçoit 401.
- Interface : écran de connexion, bouton « Se déconnecter » ; toute réponse 401 ramène à l'écran de connexion.
- Démonstration : `demo:setup` définit le mot de passe public `demonstration-agence` (données fictives uniquement).

| Méthode et route        | Rôle                                               |
| ----------------------- | -------------------------------------------------- |
| `GET /api/auth/session` | État de la session (public)                        |
| `POST /api/auth/login`  | Connexion (`password`) ; pose le cookie de session |
| `POST /api/auth/logout` | Ferme la session                                   |

## 9 ter. Accès du VPS via Tailscale

n8n tourne sur un VPS ; il joint l'API du PC par **Tailscale** (réseau privé chiffré), jamais par Internet.
Code : `apps/server/src/network/tailnet.ts` (écoute filtrée) et `network/shutdown.ts` (arrêt propre).

- **Deux écoutes** : `127.0.0.1` (inchangée, toutes les routes, pour l'interface) et, si configurée, une **deuxième
  écoute sur l'adresse Tailscale du PC**. Jamais `0.0.0.0` ni `::` : refusés au démarrage.
- **Configuration** (`.env`, lue au démarrage uniquement) : `TAILSCALE_BIND_ADDRESS` (adresse Tailscale du PC) et
  `TAILSCALE_ALLOWED_PEER` (adresse Tailscale du VPS), renseignées ensemble ou pas du tout ; l'adresse d'écoute doit
  figurer dans `ALLOWED_HOSTS`. Adresses IPv4 de la plage Tailscale (`100.64.0.0/10`) en écriture décimale stricte
  (`net.isIPv4`) : zéros en tête, hexadécimal, formes abrégées ou adresses hors plage sont refusés. Ignorées en
  démonstration (toujours locale).
- **Filtre 1, à la connexion TCP**, avant toute lecture HTTP : une connexion qui ne vient pas exactement du VPS est
  coupée sans réponse (et journalisée).
- **Filtre 2, à la requête** : seules `/api/health`, `/api/agent/…` et `GET /api/agents/me` (chemin exact) atteignent
  l'application ; toute autre route reçoit 403 (connexion de l'interface, administration des agents, routes du CRM).
  Comparaison stricte du chemin : `..`, `//`, encodages, antislash et URL absolues sont refusés.
- **Protections inchangées** ensuite : contrôle `Host`, clé d'agent obligatoire (`Authorization: Bearer`), liste
  blanche et permissions, débit, quotas, arrêt d'urgence.
- **Tailscale arrêté ou adresse indisponible** au démarrage : seule l'écoute locale démarre (erreur journalisée) ;
  redémarrer l'API une fois Tailscale connecté.
- **Arrêt propre** : les deux écoutes se ferment ; les requêtes en cours ont 5 s pour finir, puis les connexions sont
  coupées ; un second Ctrl+C quitte immédiatement.
- **Pare-feu Windows** : à compléter par une règle n'autorisant que le VPS sur le port de l'API, côté adresse
  Tailscale (non créée par le projet).

Exemple (adresses fictives) :

```
ALLOWED_HOSTS=100.90.1.10
TAILSCALE_BIND_ADDRESS=100.90.1.10
TAILSCALE_ALLOWED_PEER=100.90.2.20
```

## 10. Gestion des erreurs

- Codes centralisés dans `packages/shared/src/errors.ts`.
- Côté serveur, toute erreur prévue est une `AppError` (code + statut HTTP + message).
- Format de réponse unique : `{ "error": { "code", "message", "details?" } }`.
- Les erreurs imprévues sont journalisées en détail mais renvoyées au client sous un message générique.
- Côté interface, `ApiClientError` reprend le code de l'API (ou `NETWORK_ERROR` / `INVALID_RESPONSE`).

| Code                      | HTTP | Cas                                                                                        |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `VALIDATION_ERROR`        | 400  | Entrée invalide ; `details` liste chaque champ fautif (`path`, `message`)                  |
| `NOT_FOUND`               | 404  | Mission ou route inexistante                                                               |
| `UNAUTHENTICATED`         | 401  | Aucune identité (ni session ni clé), session expirée, clé invalide, mot de passe incorrect |
| `FORBIDDEN_ORIGIN`        | 403  | Adresse (`Host`) non autorisée, ou écriture ne venant pas de l'interface (`Origin`)        |
| `RATE_LIMITED`            | 429  | Trop de tentatives ; attendre le délai de l'en-tête `Retry-After`                          |
| `QUOTA_EXCEEDED`          | 429  | Quota journalier global des agents atteint ; `Retry-After` jusqu’à minuit (Paris)          |
| `AGENTS_DISABLED`         | 503  | Arrêt d’urgence actif (`.env` ou interrupteur de l’interface)                              |
| `OWNER_PASSWORD_NOT_SET`  | 409  | Aucun mot de passe administrateur : `npm run owner:password`                               |
| `FORBIDDEN_ACTOR`         | 403  | Action réservée à l'humain demandée par un agent ou le système                             |
| `ALREADY_EXISTS`          | 409  | Agent déjà existant, ou dossier déjà existant pour cette chaîne (`details.matches`)        |
| `IDEMPOTENCY_CONFLICT`    | 409  | Clé d'idempotence déjà utilisée pour une autre requête, ou requête identique en cours      |
| `INVALID_TRANSITION`      | 409  | Action impossible depuis le statut actuel                                                  |
| `VALIDATION_REQUIRED`     | 409  | Tentative de terminer une mission qui exige une validation                                 |
| `MAX_ATTEMPTS_REACHED`    | 409  | Plus de tentatives disponibles                                                             |
| `CONCURRENT_MODIFICATION` | 409  | Mission modifiée entre-temps                                                               |
| `DATABASE_UNAVAILABLE`    | 503  | MySQL injoignable                                                                          |
| `INTERNAL_ERROR`          | 500  | Erreur imprévue                                                                            |

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

### Problème connu : arrêt brutal du lanceur de tests sous Windows (non résolu)

**Symptôme.** De temps en temps, un processus de test de Vitest s'arrête net avec le code `3221226505`
(`0xC0000409`), ou la série reste bloquée au démarrage. Les tests du fichier en cours ne sont alors pas comptés.
Relancer la commande suffit. Ne jamais l'ignorer : un résultat n'est valable que si **tous** les tests ont tourné.

**Fréquence observée (06/11/2026).** Environ 2 séries d'intégration complètes sur 5. Une fois sur une série de
tests unitaires (`requestActor.test.ts`, sans base de données). Jamais sur un fichier lancé seul (6 essais), ni sur
30 séries unitaires isolées (15 en processus séparés, 15 en threads).

**Lot E (06/11/2026).** 2 arrêts sur 3 exécutions complètes (`app.test.ts`, puis `agents.int.test.ts`), la fréquence
semblant croître avec le nombre de fichiers de tests. Les tests interrompus ne sont pas comptés : la série a été relancée
jusqu'à un résultat complet (aucun test en échec).

**Écarté.**

- Le code de l'application : 240 créations simultanées exécutées hors de Vitest, sans aucun arrêt.
- La base de données et le pilote MySQL : l'arrêt survient aussi dans un test sans base.
- La mémoire : plus de 30 Go libres.
- Une erreur JavaScript ou une erreur fatale de V8 : aucun rapport produit avec `--report-on-fatalerror`
  et `--report-uncaught-exception`.
- Un plantage enregistré par Windows : aucun événement « Application Error » pour `node.exe`.
- L'extension VS Code Console Ninja, en partie : elle modifie `node_modules/vite/bin/vite.js` (outil en ligne de
  commande de Vite), que Vitest n'utilise pas.

**Pistes restantes.**

1. Activer les vidages mémoire Windows pour `node.exe` (clé de registre `LocalDumps`, droits administrateur) afin
   d'obtenir la pile au moment de l'arrêt.
2. Comparer avec Node 22 LTS (machine actuelle : Node 24.15).
3. Désactiver temporairement Console Ninja et l'antivirus en temps réel sur le dossier du projet.

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

| Date       | Décision                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 29/10/2026 | **TypeScript 6.0** et non 7.0 : l'outil de lint (typescript-eslint) ne prend pas encore en charge TypeScript 7.                                                                                                                                                                                                                                                                                                                                    |
| 29/10/2026 | **Prisma 7.10** (dernière version stable) et non 8.0, encore en préversion. Prisma 7 impose un adaptateur de pilote : `@prisma/adapter-mariadb`, compatible MySQL.                                                                                                                                                                                                                                                                                 |
| 29/10/2026 | Le serveur est exécuté directement en TypeScript avec **tsx** (pas d'étape de compilation). La compilation sera ajoutée en phase 7 pour Electron.                                                                                                                                                                                                                                                                                                  |
| 29/10/2026 | Le paquet `@agency/shared` est consommé en source TypeScript, sans étape de build.                                                                                                                                                                                                                                                                                                                                                                 |
| 29/10/2026 | **n8n** n'est pas encore dans `docker-compose.yml` : il sera ajouté en phase 6, quand il servira.                                                                                                                                                                                                                                                                                                                                                  |
| 29/10/2026 | L'utilisateur MySQL `agency` a tous les droits **en local** : Prisma Migrate doit pouvoir créer une base temporaire de comparaison.                                                                                                                                                                                                                                                                                                                |
| 29/10/2026 | Phase 1 : les sept statuts sont conservés. Le résultat de validation et les tentatives sont des **champs** de la mission, pas de nouveaux statuts.                                                                                                                                                                                                                                                                                                 |
| 29/10/2026 | Les règles du cycle de vie sont dans `packages/shared` (source unique). Le serveur les applique ; l'interface pourra s'en servir pour l'affichage.                                                                                                                                                                                                                                                                                                 |
| 29/10/2026 | Colonnes `status` / `room` / `action` en chaînes plutôt qu'en enums Prisma, pour ne pas dupliquer les listes du paquet partagé.                                                                                                                                                                                                                                                                                                                    |
| 29/10/2026 | Ajout de `pending → blocked` (absent du plan initial) : une mission peut être bloquée avant son démarrage (données manquantes).                                                                                                                                                                                                                                                                                                                    |
| 29/10/2026 | Refus d'un résultat = `cancelled` + `validationOutcome = rejected` ; demande de modifications = retour en `in_progress`.                                                                                                                                                                                                                                                                                                                           |
| 29/10/2026 | Historique protégé par des déclencheurs MySQL (aucune modification ni suppression possible).                                                                                                                                                                                                                                                                                                                                                       |
| 29/10/2026 | Contrôle de concurrence optimiste par `version` plutôt que par verrous : simple, et suffisant pour un usage mono-utilisateur.                                                                                                                                                                                                                                                                                                                      |
| 29/10/2026 | Prisma 7 ne régénère plus le client après une migration : `npm run db:migrate` enchaîne désormais `migrate dev` et `generate`.                                                                                                                                                                                                                                                                                                                     |
| 29/10/2026 | Phase 2 : libellés alignés sur le cahier des charges (« Mon bureau », « Salle commerciale », « Salle de suivi ») ; identifiants inchangés.                                                                                                                                                                                                                                                                                                         |
| 29/10/2026 | Mobilier construit en formes simples dans le code plutôt qu'en modèles 3D téléchargés : aucun fichier lourd, couleurs maîtrisées, aménagement vérifiable par des tests.                                                                                                                                                                                                                                                                            |
| 29/10/2026 | Étiquettes en HTML maison plutôt que le composant `Html` de drei, qui perdait une étiquette avec React 19 en mode développement.                                                                                                                                                                                                                                                                                                                   |
| 29/10/2026 | Caméra : `camera-controls` (fourni avec drei) avec `SCREEN_PAN` (déplacement sur le sol) ; cadrages calculés par `cameraMath.ts`, car son `fitToBox` réaligne la caméra sur les axes et casse la vue isométrique.                                                                                                                                                                                                                                  |
| 29/10/2026 | Ombres en `PCFShadowMap` (`shadows="percentage"`) : `PCFSoftShadowMap` a été retiré de Three.js.                                                                                                                                                                                                                                                                                                                                                   |
| 29/10/2026 | Outil de test `window.__agencyProbe`, présent **uniquement en développement**, pour les tests automatisés dans le navigateur.                                                                                                                                                                                                                                                                                                                      |
| 05/11/2026 | **Identité des agents** : identifiants préfixés `agent-` (schéma partagé + contrainte en base) : un agent ne peut jamais porter l'identité de l'humain (`owner`).                                                                                                                                                                                                                                                                                  |
| 05/11/2026 | **Clés API** : 256 bits aléatoires, stockées sous forme d'empreinte SHA-256 (un hachage lent n'apporte rien pour une clé aléatoire de cette longueur), comparées en temps constant.                                                                                                                                                                                                                                                                |
| 05/11/2026 | **Accès des agents par liste blanche** (lecture seule à cette étape) plutôt que par liste noire : une nouvelle route est fermée aux agents par défaut.                                                                                                                                                                                                                                                                                             |
| 05/11/2026 | Toute identification invalide donne **401**, jamais un repli sur l'identité humaine. Les décisions humaines sont aussi vérifiées dans les services (`assertHumanActor`).                                                                                                                                                                                                                                                                           |
| 05/11/2026 | Pas de clé étrangère `missions.agent_id → agents.id` : des missions existantes (dont la démo) citent des agents sans identité enregistrée.                                                                                                                                                                                                                                                                                                         |
| 05/11/2026 | **Permissions par agent** dans une table (`agent_permissions`) plutôt qu'en JSON : une ligne par permission, aucune par défaut.                                                                                                                                                                                                                                                                                                                    |
| 05/11/2026 | Routes des agents séparées (`/api/agent/…`) : les routes de l’interface restent inchangées et fermées en écriture aux agents.                                                                                                                                                                                                                                                                                                                      |
| 05/11/2026 | Règles des productions (étape, statut) appliquées dans la couche API des agents : le scénario de démonstration enregistre des productions déjà validées. Les invariants critiques (décisions, envois, statut des e-mails, étapes) restent dans les services.                                                                                                                                                                                       |
| 05/11/2026 | **Idempotence** par clé obligatoire et réponse enregistrée (`agent_requests`), hors de la transaction métier : si le serveur s'arrête entre l'écriture et l'enregistrement de la réponse, la clé reste « en cours » (409) jusqu'à sa purge.                                                                                                                                                                                                        |
| 05/11/2026 | Doublon détecté sur identifiant YouTube, nom ou adresse de chaîne : `ALREADY_EXISTS` remplace `INVALID_TRANSITION` pour ce cas.                                                                                                                                                                                                                                                                                                                    |
| 06/11/2026 | **Lot A** : authentification humaine par mot de passe local (scrypt, fourni par Node : aucune dépendance) et session de 12 heures en base, révocable. Toute requête sans identité est refusée.                                                                                                                                                                                                                                                     |
| 06/11/2026 | Mot de passe défini uniquement depuis le terminal : aucun écran de création de compte, donc personne ne peut l'initialiser à distance.                                                                                                                                                                                                                                                                                                             |
| 06/11/2026 | Proxy Vite en `changeOrigin: false` : nécessaire au contrôle de l'origine (constaté lors de l'essai de bout en bout).                                                                                                                                                                                                                                                                                                                              |
| 06/11/2026 | **Lot B** : numéro de dossier par compteur annuel verrouillé (fin des collisions : 19 créations simultanées sur 40 échouaient), clés de comparaison uniques en base contre les doublons.                                                                                                                                                                                                                                                           |
| 06/11/2026 | Migration sur données existantes : en cas de doublons déjà présents, seul le plus ancien dossier reçoit la clé ; aucune suppression, aucune fusion automatique.                                                                                                                                                                                                                                                                                    |
| 06/11/2026 | Numérotation annuelle : le premier dossier d'une nouvelle année est P-AAAA-0001 (auparavant, le numéro suivait le nombre total de dossiers).                                                                                                                                                                                                                                                                                                       |
| 06/11/2026 | **Lot C** : la clé d'idempotence est écrite dans la transaction métier (première instruction) au lieu d'une transaction séparée : plus d'état « en cours » bloqué après une interruption.                                                                                                                                                                                                                                                          |
| 06/11/2026 | Une répétition renvoie l'état actuel de la ressource plutôt qu'une copie de la réponse : plus de dossier complet (données personnelles) conservé dans `agent_requests`.                                                                                                                                                                                                                                                                            |
| 06/11/2026 | Arrêts brutaux de Vitest sous Windows : documentés (§ 10 bis), non masqués (pas de nouvel essai automatique des tests), cause encore inconnue.                                                                                                                                                                                                                                                                                                     |
| 06/11/2026 | Verrou de la ligne du dossier au début de chaque commande (`SELECT … FOR UPDATE`) : des écritures simultanées sur un même dossier passent l'une après l'autre au lieu d'être refusées en 409.                                                                                                                                                                                                                                                      |
| 06/11/2026 | **Lot D** : routes de l’interface fermées aux agents même en lecture ; lecture par permissions fines et dossier filtré par une seule fonction (`toAgentDossier`). Notes internes et motifs des décisions : autorisation explicite uniquement.                                                                                                                                                                                                      |
| 06/11/2026 | Les consignes destinées aux agents (nouvelle analyse, modification d’un e-mail) sont transmises seules, sans le reste de la décision humaine.                                                                                                                                                                                                                                                                                                      |
| 06/11/2026 | **Lot E** : quotas journaliers globaux (10 / 200 / 100) comptés dans la transaction de l’écriture, sur une ligne verrouillée ; un refus annule tout.                                                                                                                                                                                                                                                                                               |
| 06/11/2026 | Arrêt d’urgence à deux commandes cumulées : `AGENTS_ENABLED` (.env, non levable depuis l’interface) et interrupteur de l’interface conservé en base. Vérifié à l’entrée de la requête et dans chaque transaction d’écriture.                                                                                                                                                                                                                       |
| 06/11/2026 | **Accès du VPS par Tailscale** : deuxième écoute sur l'adresse Tailscale du PC, filtrée à la connexion (VPS seul) puis par route (routes des agents seulement), en plus de 127.0.0.1 inchangée. Jamais 0.0.0.0.                                                                                                                                                                                                                                    |
| 06/11/2026 | **Phase 1 des agents** : démarrer une mission libre l'attribue à l'agent (atomique) ; un agent ne voit que ses missions et les libres de sa salle ; mission interrompue → `blocked` (`INTERRUPTED`), jamais remise en attente automatiquement. Aucune migration : `agent_id` reste sans clé étrangère, l'existence de l'agent est vérifiée à la création.                                                                                          |
| 06/11/2026 | Un agent ne rattache un résultat (analyse, production, activité) qu'à **sa** mission **en cours** ; verrou de la mission partagé entre ces écritures et la récupération des missions interrompues. Aucune migration.                                                                                                                                                                                                                               |
| 07/11/2026 | **Phase 2, étape 1** : profils IA (`agent_profiles`) et prompts versionnés inaltérables (`agent_prompts`) ; valeurs par défaut pour Qwen3:8b (`think: false`, `num_ctx` 8192) ; `GET /api/agent/profile` pour n8n. Migration additive.                                                                                                                                                                                                             |
| 07/11/2026 | **Phase 2, étapes 2a à 2c** : contrat des exécutions (`agentRuns.ts`), action `release` réservée au système et refusée après tout effet, table `agent_runs` (une seule exécution en cours par mission, garantie par la base ; exécutions terminées inaltérables). Migration additive.                                                                                                                                                              |
| 07/11/2026 | **Phase 2, étape 2d** : prise de mission `POST /api/agent/runs/claim` (idempotente par exécution n8n, prompt actif obligatoire, reprise après demande de modification en priorité). Verrouillage candidate par candidate avec `SKIP LOCKED` : un `ORDER BY` verrouillant bloquait toute la salle.                                                                                                                                                  |
| 07/11/2026 | **Phase 2, étape 2e** : signal de vie et échec des exécutions, contrôlés par l'identifiant d'exécution n8n ; après un échec, le CRM remet la mission en attente (aucun effet, tentative restante) ou la bloque, et clôt l'exécution dans la même transaction.                                                                                                                                                                                      |
| 07/11/2026 | **Phase 2, étape 2f** : une exécution est close dans la transaction qui fait quitter `in_progress` à sa mission ; les agents ne démarrent ni ne reprennent plus par la route des transitions, uniquement par `runs/claim`, qui reprend aussi toute mission en cours à eux sans exécution.                                                                                                                                                          |
| 07/11/2026 | **Phase 2, étape 2g** : la récupération tient compte du signal de vie de l'exécution active (exclue tant qu'il date de moins de `MISSION_STALE_MINUTES`), la verrouille après la mission pour ne jamais interrompre un signal concurrent, et clôt les exécutions incohérentes (`ORPHANED_RUN`).                                                                                                                                                    |
| 07/11/2026 | **Phase 2, étape 2h** : consultation des exécutions — `GET /api/agent/runs/:id` (agent, les siennes) et `GET /api/runs` (journal paginé et filtré pour l'utilisateur), sans jamais renvoyer la sortie brute du modèle. Index `(started_at, id)` dans une migration dédiée (`20261107160000_agent_runs_started_at_index`) : une migration déjà appliquée à une base (ici `agent_runs`, appliquée à la base de démonstration) n'est jamais modifiée. |
| 09/11/2026 | **Socle du Prospecteur, étape 1** : un agent ne crée un prospect que dans sa mission de recherche en cours (`search_creators`, exécution active), à laquelle il est rattaché ; plus aucune mission de découverte pour les agents. Un échec après création de prospects bloque la recherche (effets enregistrés), sans remise en attente.                                                                                                           |
| 09/11/2026 | **Étape 2** : la revue de Mon bureau est soumise à l’utilisateur par le système dès sa création (avant : seul le scénario de démonstration le faisait, la revue restait « en attente » en réel). La validation des e-mails reste démarrée par un agent.                                                                                                                                                                                            |
| 09/11/2026 | **Étape 3** : `prospects:read_contact` exigée pour toute écriture de coordonnées, création comprise. Rôle `prospector` inchangé (public uniquement).                                                                                                                                                                                                                                                                                               |
| 09/11/2026 | **Étape 4** : mode simulation redéfini par type d’action externe (`externalActions.ts`) : lecture publique autorisée (YouTube Data API), dépenses et envois bloqués ; exposé à n8n par `GET /api/agent/capabilities`. Le CRM n’exécute aucune action externe : n8n s’y conforme.                                                                                                                                                                   |
| 09/11/2026 | **Étape 5** : schémas JSON exposés à n8n (`GET /api/agent/schemas/:name`), produits à partir des schémas Zod (forme « entrée ») ; le CRM revalide tout à la réception.                                                                                                                                                                                                                                                                             |
