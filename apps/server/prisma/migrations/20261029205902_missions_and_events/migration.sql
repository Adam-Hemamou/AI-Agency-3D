-- CreateTable
CREATE TABLE `missions` (
    `id` CHAR(36) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `room` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `priority` TINYINT NOT NULL DEFAULT 3,
    `input` JSON NOT NULL,
    `output` JSON NULL,
    `requires_validation` BOOLEAN NOT NULL DEFAULT false,
    `validation_outcome` VARCHAR(32) NULL,
    `validated_at` DATETIME(3) NULL,
    `validated_by` VARCHAR(64) NULL,
    `agent_id` VARCHAR(64) NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `last_error_code` VARCHAR(64) NULL,
    `last_error_message` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `missions_status_priority_idx`(`status`, `priority`),
    INDEX `missions_room_status_idx`(`room`, `status`),
    INDEX `missions_type_idx`(`type`),
    INDEX `missions_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mission_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mission_id` CHAR(36) NOT NULL,
    `action` VARCHAR(48) NOT NULL,
    `actor_type` VARCHAR(16) NOT NULL,
    `actor_id` VARCHAR(64) NULL,
    `from_status` VARCHAR(32) NULL,
    `to_status` VARCHAR(32) NOT NULL,
    `changes` JSON NOT NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mission_events_mission_id_id_idx`(`mission_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `mission_events` ADD CONSTRAINT `mission_events_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Historique inaltérable : la base refuse toute modification ou suppression d'un événement,
-- quelle que soit l'origine de la requête (application, outil SQL, script).
CREATE TRIGGER `mission_events_no_update` BEFORE UPDATE ON `mission_events`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'mission_events est en ajout seul : modification interdite';

CREATE TRIGGER `mission_events_no_delete` BEFORE DELETE ON `mission_events`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'mission_events est en ajout seul : suppression interdite';
