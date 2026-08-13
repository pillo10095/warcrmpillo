-- DropForeignKey
ALTER TABLE `conversations` DROP FOREIGN KEY `conversations_account_id_fkey`;

-- DropIndex
DROP INDEX `conversations_account_id_contact_id_key` ON `conversations`;

-- AlterTable
ALTER TABLE `conversations` ADD COLUMN `provider` VARCHAR(20) NOT NULL DEFAULT 'meta';

-- AlterTable
ALTER TABLE `messages` ADD COLUMN `provider` VARCHAR(20) NOT NULL DEFAULT 'meta';

-- CreateTable
CREATE TABLE `openwa_configs` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `api_url` VARCHAR(512) NOT NULL DEFAULT 'http://localhost:2785/api',
    `api_key` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'disconnected',
    `connected_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `openwa_configs_account_id_key`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `openwa_sessions` (
    `id` VARCHAR(36) NOT NULL,
    `config_id` VARCHAR(36) NOT NULL,
    `openwa_session_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `push_name` VARCHAR(255) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'created',
    `engine_type` VARCHAR(20) NOT NULL DEFAULT 'baileys',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `openwa_sessions_openwa_session_id_key`(`openwa_session_id`),
    INDEX `openwa_sessions_config_id_idx`(`config_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `conversations_account_id_contact_id_provider_key` ON `conversations`(`account_id`, `contact_id`, `provider`);

-- AddForeignKey
ALTER TABLE `openwa_configs` ADD CONSTRAINT `openwa_configs_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `openwa_sessions` ADD CONSTRAINT `openwa_sessions_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `openwa_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
