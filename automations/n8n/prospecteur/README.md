# Prospecteur YouTube (n8n)

Premier agent de l'agence : il prend la mission de recherche du jour d'une campagne, cherche des
créateurs sur YouTube, écarte les doublons et les profils hors critères, fait qualifier les autres
par Qwen3, puis enregistre les prospects retenus dans le CRM et les transmet à l'Analyste.

| Fichier                                             | Rôle                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `workflow.json`                                     | Workflow à importer dans n8n (« Prospecteur YouTube »)                 |
| `prompt-v1.md`                                      | Prompt système v1, enregistré dans le CRM par le script d'installation |
| `../../../apps/server/src/setup/setupProspector.ts` | Crée l'agent, son profil, son prompt, sa clé et la campagne de test    |

## Déroulé d'une exécution (toutes les 10 minutes)

1. `GET /api/agent/capabilities` : lecture publique autorisée ? (sinon, arrêt sans rien faire)
2. `POST /api/agent/runs/claim` : prend la mission du jour (204 : rien à faire, arrêt)
3. `GET /api/agent/profile` : prompt actif et paramètres du modèle
4. `GET /api/agent/missions/:id/campaign` : critères ACTUELS de la campagne et objectif restant
5. YouTube `search.list` : jusqu'à 3 mots-clés par jour (rotation), vidéos récentes, langue et pays
6. `GET /api/agent/channels/lookup` : écarte les chaînes déjà prospects ou déjà écartées
7. YouTube `channels.list` : abonnés, vues, pays, description, contenu pour enfants
8. Filtres simples (abonnés, pays, enfants) ; e-mail relevé seulement s'il est écrit dans la description
9. `POST /api/agent/runs/:id/heartbeat` : signal de vie
10. Pour chaque candidat (6 au plus) : Qwen3 (`/api/chat`, réponse JSON imposée) décide
    - retenu : `POST /api/agent/prospects` puis `POST /api/agent/prospects/:id/stage` (`analysis`),
      qui crée automatiquement la mission de l'Analyste ;
    - écarté : mémorisé avec son motif
11. `POST /api/agent/channels/rejections` : chaînes écartées (filtres et Qwen3)
12. `POST /api/agent/missions/:id/transitions` (`complete`) : mission terminée, avec son bilan

Le CRM garde toutes les règles : doublons (toutes campagnes), objectif quotidien, quota global,
coordonnées sourcées, arrêt d'urgence. Le workflow ne décide de rien d'autre.

## Erreurs

| Situation                                  | Comportement                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Aucune mission, campagne désactivée        | Arrêt sans rien faire                                                                                                         |
| Objectif du jour atteint                   | Les créations suivantes sont refusées par le CRM ; la mission est terminée                                                    |
| Doublon (créé entre-temps)                 | Ignoré, compté dans le bilan                                                                                                  |
| Réponse de Qwen3 invalide                  | Candidat ignoré, compté dans le bilan                                                                                         |
| Ollama injoignable pour tous les candidats | `POST /runs/:id/failure` (`LLM_UNAVAILABLE`) : le CRM remet la mission en attente si rien n'a été enregistré, sinon la bloque |
| YouTube en erreur (quota, clé)             | `POST /runs/:id/failure` (`WORKFLOW_ERROR`) avec le message de YouTube                                                        |
| Toute autre panne (CRM, réseau, n8n)       | Plus de signal de vie : le CRM bloque la mission après `MISSION_STALE_MINUTES` (60 min)                                       |

## Configuration dans n8n

1. **Identifiants** (Credentials) à créer :
   - « CRM – agent-prospecteur » : type _Header Auth_, nom `Authorization`,
     valeur `Bearer agk_…` (clé affichée UNE fois par le script d'installation) ;
   - « YouTube Data API » : type _Query Auth_, nom `key`, valeur : la clé API YouTube.
2. **Importer** `workflow.json` (menu « Import from File »), puis sélectionner les deux
   identifiants dans les nœuds qui les demandent.
3. Nœud **Configuration** : remplacer `ADRESSE_TAILSCALE_DU_PC` (deux fois) par l'adresse
   Tailscale du PC (celle de `TAILSCALE_BIND_ADDRESS` dans `.env`).
4. Tester avec « Execute workflow » (exécution manuelle), puis activer le workflow.

## Coûts et limites

- YouTube : environ 301 unités par jour et par campagne (3 recherches à 100 + 1 lecture de
  chaînes), sur 10 000 par jour.
- Qwen3:8b sur le PC : environ 6 appels par jour et par campagne. Le PC doit être allumé
  (API, MySQL et Ollama y tournent).

## Évaluation linguistique d'un créateur (CRM)

Le CRM évalue la langue et le potentiel d'un créateur pour les **deux** directions (FR → EN et
EN → FR) : `POST /api/agent/creators/assess`, permission `creators:assess` (rôle prospecteur).
Calcul seul : rien n'est enregistré. Le workflow actuel ne l'appelle pas encore.

n8n transmet les réponses de YouTube **telles quelles**, sans calcul :

```json
{
  "observedAt": "<date du relevé, ISO 8601>",
  "channel": "<items[0] de channels.list>",
  "videos": "<items de videos.list>",
  "comments": "<items de commentThreads.list>"
}
```

Le corps d'une requête d'agent est limité à **256 Ko**. Pour rester en dessous, et ne faire
transiter que le nécessaire (aucun nom, avatar ou identifiant d'auteur de commentaire), chaque
appel YouTube demande seulement les champs utiles, avec le paramètre standard `fields` :

| Appel                 | Paramètres recommandés                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channels.list`       | `part=snippet,statistics,localizations` ; `fields=items(id,snippet(title,description,defaultLanguage,country),statistics(subscriberCount,hiddenSubscriberCount,videoCount,viewCount),localizations)`                |
| `videos.list`         | `part=snippet,contentDetails,statistics,localizations` ; `fields=items(id,snippet(title,description,publishedAt,defaultLanguage,defaultAudioLanguage),contentDetails(caption),statistics(viewCount),localizations)` |
| `commentThreads.list` | `part=snippet` ; `textFormat=plainText` ; `fields=items(snippet(videoId,topLevelComment(snippet(textOriginal))))`                                                                                                   |

- **Échantillon** : 15 à 20 vidéos récentes par créateur (le CRM en accepte 50 au plus) et
  100 commentaires au plus, répartis sur 2 ou 3 vidéos récentes.
- `localizations` contient les titres et descriptions traduits : si une chaîne traduit beaucoup,
  réduire le nombre de vidéos plutôt que de dépasser 256 Ko (réponse 413).
- Coût : 1 unité par appel `channels.list`, `videos.list` (50 vidéos au plus) et
  `commentThreads.list` (une vidéo par appel).
- Les textes des commentaires ne servent qu'à compter des langues : le CRM ne les enregistre pas,
  ne les renvoie pas et ne les écrit dans aucun journal.
