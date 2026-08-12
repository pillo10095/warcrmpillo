-- AlterTable
ALTER TABLE `conversations` ADD COLUMN `ai_autoreply_disabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `ai_reply_count` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `profiles` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `full_name` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `avatar_url` TEXT NULL,
    `role` VARCHAR(50) NOT NULL DEFAULT 'user',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pipelines` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pipelines_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pipeline_stages` (
    `id` VARCHAR(36) NOT NULL,
    `pipeline_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `position` INTEGER NOT NULL,
    `color` VARCHAR(16) NOT NULL DEFAULT '#3b82f6',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pipeline_stages_pipeline_id_idx`(`pipeline_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deals` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `pipeline_id` VARCHAR(36) NOT NULL,
    `stage_id` VARCHAR(36) NOT NULL,
    `contact_id` VARCHAR(36) NOT NULL,
    `conversation_id` VARCHAR(36) NULL,
    `title` VARCHAR(255) NOT NULL,
    `value` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `notes` TEXT NULL,
    `expected_close_date` DATETIME(3) NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'open',
    `assigned_to` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `deals_user_id_idx`(`user_id`),
    INDEX `deals_pipeline_id_idx`(`pipeline_id`),
    INDEX `deals_stage_id_idx`(`stage_id`),
    INDEX `deals_contact_id_idx`(`contact_id`),
    INDEX `deals_conversation_id_idx`(`conversation_id`),
    INDEX `deals_assigned_to_idx`(`assigned_to`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `automations` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `trigger_type` VARCHAR(50) NOT NULL,
    `trigger_config` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT false,
    `execution_count` INTEGER NOT NULL DEFAULT 0,
    `last_executed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `automations_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `automation_steps` (
    `id` VARCHAR(36) NOT NULL,
    `automation_id` VARCHAR(36) NOT NULL,
    `parent_step_id` VARCHAR(36) NULL,
    `branch` VARCHAR(10) NULL,
    `step_type` VARCHAR(50) NOT NULL,
    `step_config` JSON NOT NULL,
    `position` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `automation_steps_automation_id_idx`(`automation_id`),
    INDEX `automation_steps_parent_step_id_idx`(`parent_step_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `automation_logs` (
    `id` VARCHAR(36) NOT NULL,
    `automation_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `contact_id` VARCHAR(36) NULL,
    `trigger_event` JSON NULL,
    `steps_executed` JSON NULL,
    `status` VARCHAR(20) NOT NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `automation_logs_automation_id_idx`(`automation_id`),
    INDEX `automation_logs_user_id_idx`(`user_id`),
    INDEX `automation_logs_contact_id_idx`(`contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `automation_pending_executions` (
    `id` VARCHAR(36) NOT NULL,
    `automation_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `contact_id` VARCHAR(36) NULL,
    `log_id` VARCHAR(36) NULL,
    `parent_step_id` VARCHAR(36) NULL,
    `branch` VARCHAR(10) NULL,
    `next_step_position` INTEGER NOT NULL,
    `context` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `run_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `automation_pending_executions_automation_id_idx`(`automation_id`),
    INDEX `automation_pending_executions_user_id_idx`(`user_id`),
    INDEX `automation_pending_executions_contact_id_idx`(`contact_id`),
    INDEX `automation_pending_executions_log_id_idx`(`log_id`),
    INDEX `automation_pending_executions_parent_step_id_idx`(`parent_step_id`),
    INDEX `automation_pending_executions_status_run_at_idx`(`status`, `run_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `type` VARCHAR(50) NOT NULL DEFAULT 'conversation_assigned',
    `conversation_id` VARCHAR(36) NULL,
    `contact_id` VARCHAR(36) NULL,
    `actor_user_id` VARCHAR(36) NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` TEXT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_account_id_idx`(`account_id`),
    INDEX `notifications_user_id_idx`(`user_id`),
    INDEX `notifications_conversation_id_idx`(`conversation_id`),
    INDEX `notifications_contact_id_idx`(`contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_presence` (
    `user_id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL,

    INDEX `member_presence_account_id_idx`(`account_id`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_reactions` (
    `id` VARCHAR(36) NOT NULL,
    `message_id` VARCHAR(36) NOT NULL,
    `conversation_id` VARCHAR(36) NOT NULL,
    `actor_type` VARCHAR(20) NOT NULL,
    `actorId` VARCHAR(36) NULL,
    `emoji` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `contactId` VARCHAR(36) NULL,

    INDEX `message_reactions_message_id_idx`(`message_id`),
    INDEX `message_reactions_conversation_id_idx`(`conversation_id`),
    UNIQUE INDEX `message_reactions_message_id_actor_type_actorId_key`(`message_id`, `actor_type`, `actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_fields` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `field_name` VARCHAR(255) NOT NULL,
    `field_type` VARCHAR(50) NOT NULL DEFAULT 'text',
    `field_options` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `custom_fields_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_custom_values` (
    `id` VARCHAR(36) NOT NULL,
    `contact_id` VARCHAR(36) NOT NULL,
    `custom_field_id` VARCHAR(36) NOT NULL,
    `value` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contact_custom_values_contact_id_idx`(`contact_id`),
    INDEX `contact_custom_values_custom_field_id_idx`(`custom_field_id`),
    UNIQUE INDEX `contact_custom_values_contact_id_custom_field_id_key`(`contact_id`, `custom_field_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_notes` (
    `id` VARCHAR(36) NOT NULL,
    `contact_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `note_text` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contact_notes_contact_id_idx`(`contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quick_replies` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `shortcut` VARCHAR(100) NOT NULL,
    `message_text` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `quick_replies_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_configs` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `created_by` VARCHAR(36) NULL,
    `provider` VARCHAR(50) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `api_key` TEXT NOT NULL,
    `system_prompt` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT false,
    `auto_reply_enabled` BOOLEAN NOT NULL DEFAULT false,
    `auto_reply_max_per_conversation` INTEGER NOT NULL DEFAULT 3,
    `embeddings_api_key` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_configs_account_id_key`(`account_id`),
    INDEX `ai_configs_account_id_idx`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_knowledge_documents` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `created_by` VARCHAR(36) NULL,
    `title` VARCHAR(255) NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `aiConfigId` VARCHAR(36) NULL,

    INDEX `ai_knowledge_documents_account_id_idx`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_knowledge_chunks` (
    `id` VARCHAR(36) NOT NULL,
    `document_id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `chunk_index` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `aiConfigId` VARCHAR(36) NULL,

    INDEX `ai_knowledge_chunks_document_id_idx`(`document_id`),
    INDEX `ai_knowledge_chunks_account_id_idx`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_usage_logs` (
    `id` VARCHAR(36) NOT NULL,
    `account_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `tokens_in` INTEGER NOT NULL,
    `tokens_out` INTEGER NOT NULL,
    `cost_usd` DECIMAL(12, 6) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `aiConfigId` VARCHAR(36) NULL,

    INDEX `ai_usage_logs_account_id_idx`(`account_id`),
    INDEX `ai_usage_logs_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flows` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `trigger_type` VARCHAR(50) NOT NULL,
    `trigger_config` JSON NOT NULL,
    `entry_node_id` VARCHAR(255) NULL,
    `fallback_policy` JSON NOT NULL,
    `execution_count` INTEGER NOT NULL DEFAULT 0,
    `last_executed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `flows_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flow_nodes` (
    `id` VARCHAR(36) NOT NULL,
    `flow_id` VARCHAR(36) NOT NULL,
    `node_key` VARCHAR(255) NOT NULL,
    `node_type` VARCHAR(50) NOT NULL,
    `config` JSON NOT NULL,
    `position_x` INTEGER NOT NULL DEFAULT 0,
    `position_y` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `flow_nodes_flow_id_idx`(`flow_id`),
    UNIQUE INDEX `flow_nodes_flow_id_node_key_key`(`flow_id`, `node_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flow_runs` (
    `id` VARCHAR(36) NOT NULL,
    `flow_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `contact_id` VARCHAR(36) NULL,
    `conversation_id` VARCHAR(36) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `current_node_key` VARCHAR(255) NOT NULL,
    `last_prompt_message_id` VARCHAR(36) NULL,
    `vars` JSON NOT NULL,
    `reprompt_count` INTEGER NOT NULL DEFAULT 0,
    `started_at` DATETIME(3) NOT NULL,
    `last_advanced_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `end_reason` TEXT NULL,

    INDEX `flow_runs_flow_id_idx`(`flow_id`),
    INDEX `flow_runs_user_id_idx`(`user_id`),
    INDEX `flow_runs_contact_id_idx`(`contact_id`),
    INDEX `flow_runs_conversation_id_idx`(`conversation_id`),
    INDEX `flow_runs_last_prompt_message_id_idx`(`last_prompt_message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flow_run_events` (
    `id` VARCHAR(36) NOT NULL,
    `flow_run_id` VARCHAR(36) NOT NULL,
    `event_type` VARCHAR(50) NOT NULL,
    `node_key` VARCHAR(255) NOT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `flow_run_events_flow_run_id_idx`(`flow_run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_reply_to_message_id_fkey` FOREIGN KEY (`reply_to_message_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profiles` ADD CONSTRAINT `profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pipeline_stages` ADD CONSTRAINT `pipeline_stages_pipeline_id_fkey` FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deals` ADD CONSTRAINT `deals_pipeline_id_fkey` FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deals` ADD CONSTRAINT `deals_stage_id_fkey` FOREIGN KEY (`stage_id`) REFERENCES `pipeline_stages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deals` ADD CONSTRAINT `deals_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deals` ADD CONSTRAINT `deals_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deals` ADD CONSTRAINT `deals_assigned_to_fkey` FOREIGN KEY (`assigned_to`) REFERENCES `profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_steps` ADD CONSTRAINT `automation_steps_automation_id_fkey` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_steps` ADD CONSTRAINT `automation_steps_parent_step_id_fkey` FOREIGN KEY (`parent_step_id`) REFERENCES `automation_steps`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_logs` ADD CONSTRAINT `automation_logs_automation_id_fkey` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_logs` ADD CONSTRAINT `automation_logs_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_pending_executions` ADD CONSTRAINT `automation_pending_executions_automation_id_fkey` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_pending_executions` ADD CONSTRAINT `automation_pending_executions_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_pending_executions` ADD CONSTRAINT `automation_pending_executions_log_id_fkey` FOREIGN KEY (`log_id`) REFERENCES `automation_logs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_pending_executions` ADD CONSTRAINT `automation_pending_executions_parent_step_id_fkey` FOREIGN KEY (`parent_step_id`) REFERENCES `automation_steps`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_presence` ADD CONSTRAINT `member_presence_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_reactions` ADD CONSTRAINT `message_reactions_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_reactions` ADD CONSTRAINT `message_reactions_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_reactions` ADD CONSTRAINT `message_reactions_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_custom_values` ADD CONSTRAINT `contact_custom_values_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_custom_values` ADD CONSTRAINT `contact_custom_values_custom_field_id_fkey` FOREIGN KEY (`custom_field_id`) REFERENCES `custom_fields`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_notes` ADD CONSTRAINT `contact_notes_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_configs` ADD CONSTRAINT `ai_configs_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_knowledge_documents` ADD CONSTRAINT `ai_knowledge_documents_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_knowledge_documents` ADD CONSTRAINT `ai_knowledge_documents_aiConfigId_fkey` FOREIGN KEY (`aiConfigId`) REFERENCES `ai_configs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_knowledge_chunks` ADD CONSTRAINT `ai_knowledge_chunks_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `ai_knowledge_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_knowledge_chunks` ADD CONSTRAINT `ai_knowledge_chunks_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_knowledge_chunks` ADD CONSTRAINT `ai_knowledge_chunks_aiConfigId_fkey` FOREIGN KEY (`aiConfigId`) REFERENCES `ai_configs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_usage_logs` ADD CONSTRAINT `ai_usage_logs_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_usage_logs` ADD CONSTRAINT `ai_usage_logs_aiConfigId_fkey` FOREIGN KEY (`aiConfigId`) REFERENCES `ai_configs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flow_nodes` ADD CONSTRAINT `flow_nodes_flow_id_fkey` FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flow_runs` ADD CONSTRAINT `flow_runs_flow_id_fkey` FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flow_runs` ADD CONSTRAINT `flow_runs_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flow_runs` ADD CONSTRAINT `flow_runs_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flow_runs` ADD CONSTRAINT `flow_runs_last_prompt_message_id_fkey` FOREIGN KEY (`last_prompt_message_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flow_run_events` ADD CONSTRAINT `flow_run_events_flow_run_id_fkey` FOREIGN KEY (`flow_run_id`) REFERENCES `flow_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
