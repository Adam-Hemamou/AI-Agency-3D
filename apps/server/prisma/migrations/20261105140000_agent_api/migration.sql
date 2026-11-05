-- API des agents : permissions par agent et journal des écritures (idempotence).
-- Migration additive : aucune donnée existante n'est modifiée.

-- CreateTable
CREATE TABLE `agent_permissions` (
    `agent_id` VARCHAR(64) NOT NULL,
    `permission` VARCHAR(48) NOT NULL,
    `granted_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`agent_id`, `permission`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` VARCHAR(64) NOT NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `method` VARCHAR(8) NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `response_status` INTEGER NULL,
    `response_body` JSON NULL,
    `created_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `agent_requests_created_at_idx`(`created_at`),
    UNIQUE INDEX `agent_requests_agent_id_idempotency_key_key`(`agent_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_permissions` ADD CONSTRAINT `agent_permissions_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `agent_requests` ADD CONSTRAINT `agent_requests_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Une écriture enregistrée ne peut être ni rattachée à un autre agent, ni réattribuée à une autre requête.
CREATE TRIGGER `agent_requests_guard_update` BEFORE UPDATE ON `agent_requests`
FOR EACH ROW
BEGIN
    IF NOT (NEW.`agent_id` <=> OLD.`agent_id`) OR NOT (NEW.`idempotency_key` <=> OLD.`idempotency_key`)
        OR NOT (NEW.`request_hash` <=> OLD.`request_hash`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'agent_requests : agent, clé et empreinte non modifiables';
    END IF;
END;
