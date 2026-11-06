-- Exécutions des agents (Phase 2, étape 2) : une ligne par tentative de travail d'un agent sur une
-- mission, orchestrée par n8n. Migration additive : aucune table existante n'est modifiée.

-- CreateTable
CREATE TABLE `agent_runs` (
    `id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NOT NULL,
    `agent_id` VARCHAR(64) NOT NULL,
    `attempt` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'started',
    `n8n_execution_id` VARCHAR(128) NULL,
    `prompt_version` INTEGER NOT NULL,
    `settings` JSON NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `heartbeat_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `failure_code` VARCHAR(64) NULL,
    `failure_message` TEXT NULL,
    `raw_output` MEDIUMTEXT NULL,
    `prompt_tokens` INTEGER NULL,
    `output_tokens` INTEGER NULL,
    `llm_ms` INTEGER NULL,
    -- Mission de l'exécution EN COURS uniquement (NULL sinon) : l'index unique ci-dessous garantit,
    -- au niveau de la base, qu'une mission n'a jamais deux exécutions « started » en même temps.
    `active_mission_id` CHAR(36) GENERATED ALWAYS AS (IF(`status` = 'started', `mission_id`, NULL)) STORED,

    INDEX `agent_runs_mission_id_status_idx`(`mission_id`, `status`),
    INDEX `agent_runs_agent_id_started_at_idx`(`agent_id`, `started_at`),
    INDEX `agent_runs_status_heartbeat_at_idx`(`status`, `heartbeat_at`),
    UNIQUE INDEX `agent_runs_agent_id_n8n_execution_id_key`(`agent_id`, `n8n_execution_id`),
    UNIQUE INDEX `agent_runs_one_active_per_mission`(`active_mission_id`),
    PRIMARY KEY (`id`),
    -- Mêmes valeurs que AGENT_RUN_STATUSES (packages/shared/src/agentRuns.ts).
    CONSTRAINT `agent_runs_status_check` CHECK (
        `status` IN ('started', 'succeeded', 'failed', 'released', 'abandoned', 'stopped')
    ),
    CONSTRAINT `agent_runs_attempt_check` CHECK (`attempt` >= 1),
    -- Une exécution terminée a toujours une date de fin, une exécution en cours jamais.
    CONSTRAINT `agent_runs_finished_check` CHECK ((`status` = 'started') = (`finished_at` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_runs` ADD CONSTRAINT `agent_runs_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `agent_runs` ADD CONSTRAINT `agent_runs_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey : la version du prompt utilisée existe forcément, et appartient au même agent.
ALTER TABLE `agent_runs` ADD CONSTRAINT `agent_runs_agent_id_prompt_version_fkey` FOREIGN KEY (`agent_id`, `prompt_version`) REFERENCES `agent_prompts`(`agent_id`, `version`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Traçabilité, au niveau de la base (même depuis un outil SQL) :
-- - l'identité d'une exécution (mission, agent, tentative, prompt, paramètres, début, exécution n8n)
--   ne change jamais ;
-- - une exécution terminée n'est plus modifiée ;
-- - aucune exécution n'est supprimée.
CREATE TRIGGER `agent_runs_guard_update` BEFORE UPDATE ON `agent_runs`
FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'started' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'agent_runs : une exécution terminée ne peut plus être modifiée';
    END IF;
    IF NOT (NEW.`id` <=> OLD.`id`) OR NOT (NEW.`mission_id` <=> OLD.`mission_id`)
        OR NOT (NEW.`agent_id` <=> OLD.`agent_id`) OR NOT (NEW.`attempt` <=> OLD.`attempt`)
        OR NOT (NEW.`prompt_version` <=> OLD.`prompt_version`) OR NOT (NEW.`settings` <=> OLD.`settings`)
        OR NOT (NEW.`started_at` <=> OLD.`started_at`)
        OR NOT (NEW.`n8n_execution_id` <=> OLD.`n8n_execution_id`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'agent_runs : identité de l''exécution non modifiable';
    END IF;
END;

CREATE TRIGGER `agent_runs_no_delete` BEFORE DELETE ON `agent_runs`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'agent_runs : suppression interdite';
