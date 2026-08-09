-- CreateTable
CREATE TABLE `contacts` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `phone_normalized` VARCHAR(32) GENERATED ALWAYS AS (REGEXP_REPLACE(`phone`, '[^0-9]', '')) STORED,
    `name` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `company` VARCHAR(255) NULL,
    `avatar_url` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `contacts_account_id_idx`(`account_id`),
    INDEX `contacts_phone_idx`(`phone`),
    UNIQUE INDEX `contacts_account_id_phone_normalized_key`(`account_id`, `phone_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tags` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `color` VARCHAR(16) NOT NULL DEFAULT '#3b82f6',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tags_account_id_idx`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_tags` (
    `id` VARCHAR(36) NOT NULL,
    `contact_id` VARCHAR(36) NOT NULL,
    `tag_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contact_tags_contact_id_idx`(`contact_id`),
    INDEX `contact_tags_tag_id_idx`(`tag_id`),
    UNIQUE INDEX `contact_tags_contact_id_tag_id_key`(`contact_id`, `tag_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `contact_id` VARCHAR(36) NOT NULL,
    `status` ENUM('open', 'pending', 'closed') NOT NULL DEFAULT 'open',
    `assigned_agent_id` VARCHAR(36) NULL,
    `last_message_text` TEXT NULL,
    `last_message_at` DATETIME(3) NULL,
    `unread_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `conversations_contact_id_idx`(`contact_id`),
    UNIQUE INDEX `conversations_account_id_contact_id_key`(`account_id`, `contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` VARCHAR(36) NOT NULL,
    `conversation_id` VARCHAR(36) NOT NULL,
    `sender_type` ENUM('customer', 'agent', 'bot') NOT NULL,
    `sender_id` VARCHAR(36) NULL,
    `content_type` ENUM('text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive') NOT NULL DEFAULT 'text',
    `content_text` TEXT NULL,
    `media_url` TEXT NULL,
    `template_name` VARCHAR(255) NULL,
    `message_id` VARCHAR(255) NULL,
    `status` ENUM('sending', 'sent', 'delivered', 'read', 'failed') NOT NULL DEFAULT 'sent',
    `reply_to_message_id` VARCHAR(36) NULL,
    `interactive_reply_id` VARCHAR(255) NULL,
    `interactive_payload` JSON NULL,
    `ai_generated` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `messages_message_id_idx`(`message_id`),
    INDEX `messages_reply_to_message_id_idx`(`reply_to_message_id`),
    UNIQUE INDEX `messages_conversation_id_message_id_key`(`conversation_id`, `message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_config` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `phone_number_id` VARCHAR(64) NOT NULL,
    `waba_id` VARCHAR(64) NULL,
    `access_token` TEXT NOT NULL,
    `verify_token` TEXT NULL,
    `status` ENUM('connected', 'disconnected') NOT NULL DEFAULT 'disconnected',
    `connected_at` DATETIME(3) NULL,
    `registered_at` DATETIME(3) NULL,
    `subscribed_apps_at` DATETIME(3) NULL,
    `last_registration_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `whatsapp_config_account_id_key`(`account_id`),
    UNIQUE INDEX `whatsapp_config_phone_number_id_key`(`phone_number_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_templates` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `category` ENUM('Marketing', 'Utility', 'Authentication') NOT NULL DEFAULT 'Marketing',
    `language` VARCHAR(16) NOT NULL DEFAULT 'en_US',
    `header_type` ENUM('text', 'image', 'video', 'document') NULL,
    `header_content` TEXT NULL,
    `body_text` TEXT NOT NULL,
    `footer_text` TEXT NULL,
    `buttons` JSON NULL,
    `sample_values` JSON NULL,
    `meta_template_id` VARCHAR(255) NULL,
    `rejection_reason` TEXT NULL,
    `quality_score` ENUM('GREEN', 'YELLOW', 'RED') NULL,
    `header_handle` VARCHAR(512) NULL,
    `header_media_url` TEXT NULL,
    `submission_error` TEXT NULL,
    `last_submitted_at` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION') NOT NULL DEFAULT 'DRAFT',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `message_templates_account_id_idx`(`account_id`),
    INDEX `message_templates_meta_template_id_idx`(`meta_template_id`),
    UNIQUE INDEX `message_templates_user_id_name_language_key`(`user_id`, `name`, `language`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broadcasts` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `template_name` VARCHAR(255) NOT NULL,
    `template_language` VARCHAR(16) NOT NULL DEFAULT 'en_US',
    `template_variables` JSON NULL,
    `audience_filter` JSON NULL,
    `scheduled_at` DATETIME(3) NULL,
    `status` ENUM('draft', 'scheduled', 'sending', 'sent', 'failed') NOT NULL DEFAULT 'draft',
    `total_recipients` INTEGER NOT NULL DEFAULT 0,
    `sent_count` INTEGER NOT NULL DEFAULT 0,
    `delivered_count` INTEGER NOT NULL DEFAULT 0,
    `read_count` INTEGER NOT NULL DEFAULT 0,
    `replied_count` INTEGER NOT NULL DEFAULT 0,
    `failed_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `broadcasts_account_id_idx`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broadcast_recipients` (
    `id` VARCHAR(36) NOT NULL,
    `broadcast_id` VARCHAR(36) NOT NULL,
    `contact_id` VARCHAR(36) NULL,
    `status` ENUM('pending', 'sent', 'delivered', 'read', 'replied', 'failed') NOT NULL DEFAULT 'pending',
    `sent_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `read_at` DATETIME(3) NULL,
    `replied_at` DATETIME(3) NULL,
    `error_message` TEXT NULL,
    `whatsapp_message_id` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `broadcast_recipients_whatsapp_message_id_key`(`whatsapp_message_id`),
    INDEX `broadcast_recipients_broadcast_id_status_idx`(`broadcast_id`, `status`),
    INDEX `broadcast_recipients_contact_id_idx`(`contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ContactTagJoin` (
    `A` VARCHAR(36) NOT NULL,
    `B` VARCHAR(36) NOT NULL,

    UNIQUE INDEX `_ContactTagJoin_AB_unique`(`A`, `B`),
    INDEX `_ContactTagJoin_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tags` ADD CONSTRAINT `tags_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_tags` ADD CONSTRAINT `contact_tags_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_tags` ADD CONSTRAINT `contact_tags_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsapp_config` ADD CONSTRAINT `whatsapp_config_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_templates` ADD CONSTRAINT `message_templates_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broadcasts` ADD CONSTRAINT `broadcasts_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broadcast_recipients` ADD CONSTRAINT `broadcast_recipients_broadcast_id_fkey` FOREIGN KEY (`broadcast_id`) REFERENCES `broadcasts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broadcast_recipients` ADD CONSTRAINT `broadcast_recipients_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ContactTagJoin` ADD CONSTRAINT `_ContactTagJoin_A_fkey` FOREIGN KEY (`A`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ContactTagJoin` ADD CONSTRAINT `_ContactTagJoin_B_fkey` FOREIGN KEY (`B`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
