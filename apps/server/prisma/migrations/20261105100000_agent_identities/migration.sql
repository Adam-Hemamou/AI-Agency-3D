-- Agents IA : identité et clés API. Migration additive : aucune donnée existante n'est modifiée.

-- CreateTable
CREATE TABLE `agents` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `room` VARCHAR(32) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    -- Un agent ne peut jamais porter l'identifiant de l'humain ("owner") ni un identifiant ambigu.
    CONSTRAINT `agents_id_prefix_check` CHECK (`id` LIKE 'agent-%')
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_api_keys` (
    `id` CHAR(36) NOT NULL,
    `agent_id` VARCHAR(64) NOT NULL,
    `prefix` VARCHAR(24) NOT NULL,
    `secret_hash` CHAR(64) NOT NULL,
    `label` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `agent_api_keys_prefix_key`(`prefix`),
    INDEX `agent_api_keys_agent_id_idx`(`agent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_api_keys` ADD CONSTRAINT `agent_api_keys_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Protection des clés, au niveau de la base (même depuis un outil SQL) :
-- - une clé n'est jamais supprimée (traçabilité) ;
-- - son agent, son identifiant public et son empreinte ne changent jamais ;
-- - une clé révoquée ne peut pas être réactivée.
CREATE TRIGGER `agent_api_keys_no_delete` BEFORE DELETE ON `agent_api_keys`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'agent_api_keys : suppression interdite (révoquer la clé à la place)';

CREATE TRIGGER `agent_api_keys_guard_update` BEFORE UPDATE ON `agent_api_keys`
FOR EACH ROW
BEGIN
    IF NOT (NEW.`agent_id` <=> OLD.`agent_id`) OR NOT (NEW.`prefix` <=> OLD.`prefix`)
        OR NOT (NEW.`secret_hash` <=> OLD.`secret_hash`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'agent_api_keys : agent, préfixe et empreinte non modifiables';
    END IF;
    IF OLD.`revoked_at` IS NOT NULL AND NOT (NEW.`revoked_at` <=> OLD.`revoked_at`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'agent_api_keys : une clé révoquée ne peut pas être réactivée';
    END IF;
END;
