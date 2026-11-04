-- CRM : dossiers prospects centralisés. Migration additive : aucune donnée existante n'est modifiée.
-- AlterTable
ALTER TABLE `missions` ADD COLUMN `prospect_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `prospects` (
    `id` CHAR(36) NOT NULL,
    `reference` VARCHAR(20) NOT NULL,
    `creator_name` VARCHAR(120) NOT NULL,
    `channel_name` VARCHAR(160) NOT NULL,
    `channel_handle` VARCHAR(120) NULL,
    `youtube_channel_id` VARCHAR(64) NULL,
    `channel_url` VARCHAR(500) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `category` VARCHAR(80) NULL,
    `description` TEXT NULL,
    `country` VARCHAR(80) NULL,
    `subscriber_count` INTEGER NULL,
    `view_count` BIGINT NULL,
    `video_count` INTEGER NULL,
    `stats_source` VARCHAR(200) NULL,
    `stats_updated_at` DATETIME(3) NULL,
    `contact_email` VARCHAR(254) NULL,
    `contact_name` VARCHAR(120) NULL,
    `contact_source` VARCHAR(200) NULL,
    `discovery` JSON NULL,
    `stage` VARCHAR(32) NOT NULL DEFAULT 'prospecting',
    `relationship_status` VARCHAR(32) NULL,
    `priority` TINYINT NOT NULL DEFAULT 3,
    `do_not_contact` BOOLEAN NOT NULL DEFAULT false,
    `do_not_contact_reason` VARCHAR(500) NULL,
    `next_action` VARCHAR(500) NULL,
    `next_action_at` DATETIME(3) NULL,
    `is_demo` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 0,
    `discovered_at` DATETIME(3) NOT NULL,
    `last_activity_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `prospects_reference_key`(`reference`),
    UNIQUE INDEX `prospects_youtube_channel_id_key`(`youtube_channel_id`),
    INDEX `prospects_stage_priority_idx`(`stage`, `priority`),
    INDEX `prospects_last_activity_at_idx`(`last_activity_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prospect_analyses` (
    `id` CHAR(36) NOT NULL,
    `prospect_id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NULL,
    `version` INTEGER NOT NULL,
    `summary` TEXT NOT NULL,
    `conclusion` TEXT NOT NULL,
    `score` TINYINT NULL,
    `score_criteria` JSON NOT NULL,
    `priority` TINYINT NOT NULL,
    `content` JSON NOT NULL,
    `sources` JSON NOT NULL,
    `actor_type` VARCHAR(16) NOT NULL,
    `actor_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `prospect_analyses_prospect_id_version_key`(`prospect_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prospect_productions` (
    `id` CHAR(36) NOT NULL,
    `prospect_id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NULL,
    `kind` VARCHAR(32) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `title` VARCHAR(250) NULL,
    `content` JSON NOT NULL,
    `actor_type` VARCHAR(16) NOT NULL,
    `actor_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `prospect_productions_prospect_id_kind_version_key`(`prospect_id`, `kind`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prospect_decisions` (
    `id` CHAR(36) NOT NULL,
    `prospect_id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NULL,
    `production_id` CHAR(36) NULL,
    `kind` VARCHAR(48) NOT NULL,
    `reason` TEXT NULL,
    `actor_type` VARCHAR(16) NOT NULL,
    `actor_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL,

    INDEX `prospect_decisions_prospect_id_created_at_idx`(`prospect_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prospect_messages` (
    `id` CHAR(36) NOT NULL,
    `prospect_id` CHAR(36) NOT NULL,
    `production_id` CHAR(36) NULL,
    `direction` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `delivery` VARCHAR(16) NOT NULL,
    `from_address` VARCHAR(254) NULL,
    `to_address` VARCHAR(254) NULL,
    `subject` VARCHAR(250) NULL,
    `body` TEXT NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,

    INDEX `prospect_messages_prospect_id_occurred_at_idx`(`prospect_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prospect_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prospect_id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NULL,
    `type` VARCHAR(48) NOT NULL,
    `room` VARCHAR(32) NULL,
    `title` VARCHAR(250) NOT NULL,
    `details` TEXT NULL,
    `payload` JSON NOT NULL,
    `actor_type` VARCHAR(16) NOT NULL,
    `actor_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL,

    INDEX `prospect_events_prospect_id_created_at_idx`(`prospect_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `missions_prospect_id_idx` ON `missions`(`prospect_id`);

-- AddForeignKey
ALTER TABLE `missions` ADD CONSTRAINT `missions_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `prospect_analyses` ADD CONSTRAINT `prospect_analyses_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `prospect_productions` ADD CONSTRAINT `prospect_productions_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `prospect_decisions` ADD CONSTRAINT `prospect_decisions_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `prospect_messages` ADD CONSTRAINT `prospect_messages_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `prospect_events` ADD CONSTRAINT `prospect_events_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Timeline inaltérable : la base refuse toute modification ou suppression d'un événement.
CREATE TRIGGER `prospect_events_no_update` BEFORE UPDATE ON `prospect_events`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'prospect_events est en ajout seul : modification interdite';

CREATE TRIGGER `prospect_events_no_delete` BEFORE DELETE ON `prospect_events`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'prospect_events est en ajout seul : suppression interdite';
