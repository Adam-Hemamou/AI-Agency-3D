-- Renforcement de la sécurité (lots A à E). Migration additive : aucune donnée existante n'est modifiée.

-- Lot A : authentification de l'utilisateur humain.
-- CreateTable
CREATE TABLE `owner_credentials` (
    `id` VARCHAR(16) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `owner_sessions` (
    `id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `owner_sessions_token_hash_key`(`token_hash`),
    INDEX `owner_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Lot B : numérotation fiable des dossiers et anti-doublon garanti par la base.
-- Aucune donnée n'est supprimée ni modifiée en dehors des deux nouvelles colonnes.

-- CreateTable
CREATE TABLE `prospect_counters` (
    `year` INTEGER NOT NULL,
    `last_number` INTEGER NOT NULL,

    PRIMARY KEY (`year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Les compteurs repartent du plus grand numéro existant de chaque année.
-- lot-b:counters:begin
INSERT INTO `prospect_counters` (`year`, `last_number`)
SELECT CAST(SUBSTRING(`reference`, 3, 4) AS UNSIGNED), MAX(CAST(SUBSTRING(`reference`, 8) AS UNSIGNED))
FROM `prospects`
WHERE `reference` REGEXP '^P-[0-9]{4}-[0-9]+$'
GROUP BY CAST(SUBSTRING(`reference`, 3, 4) AS UNSIGNED);
-- lot-b:counters:end

-- AlterTable
ALTER TABLE `prospects` ADD COLUMN `channel_handle_key` VARCHAR(120) NULL,
    ADD COLUMN `channel_url_key` VARCHAR(500) NULL;

-- Clés des dossiers existants (mêmes règles que channelHandleKey / channelUrlKey du paquet partagé).
-- Si des doublons existent déjà, seul le plus ancien dossier reçoit la clé : aucun dossier n'est
-- supprimé ni fusionné, et « npm run db:check-duplicates » les signale.
-- lot-b:keys:begin
UPDATE `prospects` AS p
JOIN (
    SELECT `id`, k, ROW_NUMBER() OVER (PARTITION BY k ORDER BY `created_at`, `id`) AS rn
    FROM (
        SELECT `id`, `created_at`,
            COALESCE(
                NULLIF(LOWER(TRIM(LEADING '@' FROM TRIM(`channel_handle`))), ''),
                CASE WHEN REGEXP_LIKE(`channel_url`, '^https?://[^/?#[:space:]]+/@[^/?#[:space:]]+', 'i')
                    THEN NULLIF(LOWER(TRIM(LEADING '@' FROM REGEXP_REPLACE(`channel_url`,
                        '^https?://[^/?#[:space:]]+/@([^/?#[:space:]]+).*$', '$1', 1, 0, 'i'))), '')
                END
            ) AS k
        FROM `prospects`
    ) AS candidates
    WHERE k IS NOT NULL
) AS ranked ON ranked.`id` = p.`id`
SET p.`channel_handle_key` = ranked.k
WHERE ranked.rn = 1;

UPDATE `prospects` AS p
JOIN (
    SELECT `id`, k, ROW_NUMBER() OVER (PARTITION BY k ORDER BY `created_at`, `id`) AS rn
    FROM (
        SELECT `id`, `created_at`,
            NULLIF(TRIM(TRAILING '/' FROM REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
                LOWER(TRIM(`channel_url`)), '^https?://', ''), '^(www\.|m\.)', ''), '[?#].*$', '')), '') AS k
        FROM `prospects`
    ) AS candidates
    WHERE k IS NOT NULL
) AS ranked ON ranked.`id` = p.`id`
SET p.`channel_url_key` = ranked.k
WHERE ranked.rn = 1;
-- lot-b:keys:end

-- CreateIndex
CREATE UNIQUE INDEX `prospects_channel_handle_key_key` ON `prospects`(`channel_handle_key`);

-- CreateIndex
CREATE UNIQUE INDEX `prospects_channel_url_key_key` ON `prospects`(`channel_url_key`);

-- Lot C : idempotence enregistrée dans la transaction de l'écriture.
-- Les lignes existantes sont conservées telles quelles.
-- AlterTable
ALTER TABLE `agent_requests` ADD COLUMN `resource_type` VARCHAR(16) NULL,
    ADD COLUMN `resource_id` VARCHAR(36) NULL,
    ADD COLUMN `event_id` INTEGER NULL;

-- Lot E : quotas journaliers globaux des agents et arrêt d'urgence.
-- CreateTable
CREATE TABLE `agent_quota_usage` (
    `day` VARCHAR(10) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `used` INTEGER NOT NULL,

    PRIMARY KEY (`day`, `action`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_switch` (
    `id` VARCHAR(16) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
