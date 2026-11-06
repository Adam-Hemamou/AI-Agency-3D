-- Journal des exécutions (GET /api/runs, Phase 2 étape 2h) : tri chronologique par date de début,
-- puis identifiant, sans tri en mémoire. Migration additive : un index, aucune donnée modifiée.
-- Séparée de 20261107140000_agent_runs, déjà appliquée à une base : une migration appliquée
-- n'est jamais modifiée.

-- CreateIndex
CREATE INDEX `agent_runs_started_at_id_idx` ON `agent_runs`(`started_at`, `id`);
