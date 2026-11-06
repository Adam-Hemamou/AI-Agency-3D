-- Profils IA des agents et prompts système versionnés (Phase 2, étape 1).
-- Migration additive : aucune table existante n'est modifiée, aucune donnée n'est touchée.

-- CreateTable
CREATE TABLE `agent_profiles` (
    `agent_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NULL,
    `model` VARCHAR(64) NOT NULL,
    `temperature` DOUBLE NOT NULL,
    `top_p` DOUBLE NOT NULL,
    `top_k` INTEGER NOT NULL,
    `num_ctx` INTEGER NOT NULL,
    `num_predict` INTEGER NOT NULL,
    `think` BOOLEAN NOT NULL,
    `timeout_seconds` INTEGER NOT NULL,
    `active_prompt_version` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` VARCHAR(64) NOT NULL,

    PRIMARY KEY (`agent_id`),
    -- Mêmes bornes que AGENT_MODEL_LIMITS (packages/shared) : refusées même depuis un outil SQL.
    CONSTRAINT `agent_profiles_settings_check` CHECK (
        `temperature` BETWEEN 0 AND 2
        AND `top_p` > 0 AND `top_p` <= 1
        AND `top_k` BETWEEN 1 AND 200
        AND `num_ctx` BETWEEN 2048 AND 32768
        AND `num_predict` BETWEEN 64 AND 8192
        AND `timeout_seconds` BETWEEN 10 AND 900
    )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_prompts` (
    `agent_id` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL,
    `system_prompt` MEDIUMTEXT NOT NULL,
    `note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,

    PRIMARY KEY (`agent_id`, `version`),
    CONSTRAINT `agent_prompts_version_check` CHECK (`version` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_profiles` ADD CONSTRAINT `agent_profiles_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey : la version active existe forcément, et appartient au même agent.
ALTER TABLE `agent_profiles` ADD CONSTRAINT `agent_profiles_agent_id_active_prompt_version_fkey` FOREIGN KEY (`agent_id`, `active_prompt_version`) REFERENCES `agent_prompts`(`agent_id`, `version`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `agent_prompts` ADD CONSTRAINT `agent_prompts_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Versions des prompts : ajout uniquement, au niveau de la base (même depuis un outil SQL).
-- Une version utilisée par une exécution doit rester lisible telle quelle (traçabilité).
CREATE TRIGGER `agent_prompts_no_update` BEFORE UPDATE ON `agent_prompts`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'agent_prompts est en ajout seul : modification interdite (créer une nouvelle version)';

CREATE TRIGGER `agent_prompts_no_delete` BEFORE DELETE ON `agent_prompts`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'agent_prompts est en ajout seul : suppression interdite';
