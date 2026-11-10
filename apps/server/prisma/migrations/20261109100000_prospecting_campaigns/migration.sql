-- Campagnes de prospection et mémoire des chaînes écartées (socle du Prospecteur, étape 6).
--
-- Migration ADDITIVE : aucune table ni colonne existante n'est modifiée ou supprimée, aucune donnée
-- n'est touchée. Les nouvelles colonnes de `missions` et `prospects` sont facultatives (NULL).
--
-- Générée par « prisma migrate diff » (même moteur que « migrate dev --create-only », qui refuse de
-- s'exécuter hors d'un terminal interactif), puis RELUE À LA MAIN. Retiré du SQL généré :
--   DROP INDEX `agent_runs_one_active_per_mission` ON `agent_runs`;
--   ALTER TABLE `agent_runs` DROP COLUMN `active_mission_id`;
-- Cette colonne générée et son index unique (une seule exécution active par mission) sont définis
-- en SQL (migration 20261107140000_agent_runs) : Prisma ne sait pas les décrire et propose à tort de
-- les supprimer à chaque nouvelle migration. Ils doivent être conservés.

-- Missions : campagne d'origine et jour (une seule mission par campagne et par jour, garanti par
-- l'index unique ; MySQL accepte plusieurs NULL : les autres missions ne sont pas concernées).
ALTER TABLE `missions` ADD COLUMN `campaign_day` VARCHAR(10) NULL,
    ADD COLUMN `campaign_id` CHAR(36) NULL;

-- Prospects : mission de recherche dans laquelle un agent l'a découvert (objectif quotidien,
-- traçabilité). Les prospects existants restent à NULL.
ALTER TABLE `prospects` ADD COLUMN `discovery_mission_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `prospecting_campaigns` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `agent_id` VARCHAR(64) NULL,
    `themes` JSON NOT NULL,
    `keywords` JSON NOT NULL,
    `languages` JSON NOT NULL,
    `countries` JSON NOT NULL,
    `min_subscribers` INTEGER NULL,
    `max_subscribers` INTEGER NULL,
    `max_days_since_last_video` INTEGER NOT NULL,
    `daily_target` INTEGER NOT NULL,
    `reevaluation_days` INTEGER NOT NULL,
    `priority` TINYINT NOT NULL DEFAULT 3,
    `version` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` VARCHAR(64) NOT NULL,

    UNIQUE INDEX `prospecting_campaigns_name_key`(`name`),
    INDEX `prospecting_campaigns_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rejected_channels` (
    `id` CHAR(36) NOT NULL,
    `platform` VARCHAR(16) NOT NULL,
    `channel_id` VARCHAR(64) NOT NULL,
    `channel_title` VARCHAR(160) NULL,
    `campaign_id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NOT NULL,
    `agent_id` VARCHAR(64) NOT NULL,
    `reason_code` VARCHAR(32) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `rejection_count` INTEGER NOT NULL DEFAULT 1,
    `first_rejected_at` DATETIME(3) NOT NULL,
    `rejected_at` DATETIME(3) NOT NULL,
    `reevaluate_after` DATETIME(3) NOT NULL,

    INDEX `rejected_channels_campaign_id_reevaluate_after_idx`(`campaign_id`, `reevaluate_after`),
    INDEX `rejected_channels_mission_id_idx`(`mission_id`),
    UNIQUE INDEX `rejected_channels_platform_channel_id_campaign_id_key`(`platform`, `channel_id`, `campaign_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `missions_campaign_id_campaign_day_key` ON `missions`(`campaign_id`, `campaign_day`);

-- CreateIndex
CREATE INDEX `prospects_discovery_mission_id_idx` ON `prospects`(`discovery_mission_id`);

-- AddForeignKey
ALTER TABLE `missions` ADD CONSTRAINT `missions_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `prospecting_campaigns`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_discovery_mission_id_fkey` FOREIGN KEY (`discovery_mission_id`) REFERENCES `missions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `prospecting_campaigns` ADD CONSTRAINT `prospecting_campaigns_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `rejected_channels` ADD CONSTRAINT `rejected_channels_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `prospecting_campaigns`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `rejected_channels` ADD CONSTRAINT `rejected_channels_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `rejected_channels` ADD CONSTRAINT `rejected_channels_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
