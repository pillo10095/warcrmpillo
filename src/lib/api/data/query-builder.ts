// ── Table name → Prisma model mapping ────────────────────────────
export const TABLE_MODEL_MAP: Record<string, string> = {
  users: "user",
  sessions: "session",
  accounts: "account",
  account_members: "accountMember",
  contacts: "contact",
  tags: "tag",
  contact_tags: "contactTag",
  conversations: "conversation",
  messages: "message",
  whatsapp_config: "whatsAppConfig",
  message_templates: "messageTemplate",
  broadcasts: "broadcast",
  broadcast_recipients: "broadcastRecipient",
  api_keys: "apiKey",
  webhook_endpoints: "webhookEndpoint",
  files: "fileRecord",
  account_invitations: "invitation",
  invitations: "invitation",
  profiles: "profile",
  deals: "deal",
  pipelines: "pipeline",
  pipeline_stages: "pipelineStage",
  automations: "automation",
  automation_steps: "automationStep",
  automation_logs: "automationLog",
  automation_pending_executions: "automationPendingExecution",
  notifications: "notification",
  member_presence: "memberPresence",
  message_reactions: "messageReaction",
  custom_fields: "customField",
  contact_custom_values: "contactCustomValue",
  contact_notes: "contactNote",
  quick_replies: "quickReply",
  ai_configs: "aiConfig",
  ai_knowledge_documents: "aiKnowledgeDocument",
  ai_knowledge_chunks: "aiKnowledgeChunk",
  ai_usage_logs: "aiUsageLog",
  flows: "flow",
  flow_nodes: "flowNode",
  flow_runs: "flowRun",
  flow_run_events: "flowRunEvent",
};

// ── Column name → Prisma field mapping (snake_case → camelCase) ──
// Built dynamically from table name patterns; covers the common
// `account_id` → `accountId` style mapping.
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ── Known column→field overrides for columns that don't follow the
//    simple snake_to_camel pattern (e.g. @@map renames).
const COLUMN_OVERRIDES: Record<string, Record<string, string>> = {
  users: {
    password_hash: "passwordHash",
    full_name: "fullName",
    avatar_url: "avatarUrl",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  sessions: {
    user_id: "userId",
    token_hash: "tokenHash",
    expires_at: "expiresAt",
    created_at: "createdAt",
    last_seen_at: "lastSeenAt",
  },
  accounts: {
    owner_user_id: "ownerUserId",
    default_currency: "defaultCurrency",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  account_members: {
    user_id: "userId",
    account_id: "accountId",
    created_at: "createdAt",
  },
  contacts: {
    account_id: "accountId",
    user_id: "userId",
    phone_normalized: "phoneNormalized",
    avatar_url: "avatarUrl",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  tags: {
    account_id: "accountId",
    user_id: "userId",
    created_at: "createdAt",
  },
  contact_tags: {
    contact_id: "contactId",
    tag_id: "tagId",
    created_at: "createdAt",
  },
  conversations: {
    account_id: "accountId",
    user_id: "userId",
    contact_id: "contactId",
    assigned_agent_id: "assignedAgentId",
    last_message_text: "lastMessageText",
    last_message_at: "lastMessageAt",
    unread_count: "unreadCount",
    ai_autoreply_disabled: "aiAutoreplyDisabled",
    ai_reply_count: "aiReplyCount",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  messages: {
    conversation_id: "conversationId",
    sender_type: "senderType",
    sender_id: "senderId",
    content_type: "contentType",
    content_text: "contentText",
    media_url: "mediaUrl",
    template_name: "templateName",
    message_id: "messageId",
    reply_to_message_id: "replyToMessageId",
    interactive_reply_id: "interactiveReplyId",
    interactive_payload: "interactivePayload",
    ai_generated: "aiGenerated",
    created_at: "createdAt",
  },
  whatsapp_config: {
    account_id: "accountId",
    user_id: "userId",
    phone_number_id: "phoneNumberId",
    waba_id: "wabaId",
    access_token: "accessToken",
    verify_token: "verifyToken",
    connected_at: "connectedAt",
    registered_at: "registeredAt",
    subscribed_apps_at: "subscribedAppsAt",
    last_registration_error: "lastRegistrationError",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  message_templates: {
    account_id: "accountId",
    user_id: "userId",
    header_type: "headerType",
    header_content: "headerContent",
    body_text: "bodyText",
    footer_text: "footerText",
    sample_values: "sampleValues",
    meta_template_id: "metaTemplateId",
    rejection_reason: "rejectionReason",
    quality_score: "qualityScore",
    header_handle: "headerHandle",
    header_media_url: "headerMediaUrl",
    submission_error: "submissionError",
    last_submitted_at: "lastSubmittedAt",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  broadcasts: {
    account_id: "accountId",
    user_id: "userId",
    template_name: "templateName",
    template_language: "templateLanguage",
    template_variables: "templateVariables",
    audience_filter: "audienceFilter",
    scheduled_at: "scheduledAt",
    total_recipients: "totalRecipients",
    sent_count: "sentCount",
    delivered_count: "deliveredCount",
    read_count: "readCount",
    replied_count: "repliedCount",
    failed_count: "failedCount",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  broadcast_recipients: {
    broadcast_id: "broadcastId",
    contact_id: "contactId",
    sent_at: "sentAt",
    delivered_at: "deliveredAt",
    read_at: "readAt",
    replied_at: "repliedAt",
    error_message: "errorMessage",
    whatsapp_message_id: "whatsappMessageId",
    created_at: "createdAt",
  },
  api_keys: {
    account_id: "accountId",
    created_by: "createdBy",
    key_prefix: "keyPrefix",
    key_hash: "keyHash",
    last_used_at: "lastUsedAt",
    expires_at: "expiresAt",
    revoked_at: "revokedAt",
    created_at: "createdAt",
  },
  webhook_endpoints: {
    account_id: "accountId",
    created_by: "createdBy",
    is_active: "isActive",
    last_delivery_at: "lastDeliveryAt",
    failure_count: "failureCount",
    created_at: "createdAt",
  },
  files: {
    account_id: "accountId",
    original_name: "originalName",
    disk_path: "diskPath",
    created_at: "createdAt",
  },
  account_invitations: {
    account_id: "accountId",
    token_hash: "tokenHash",
    created_by_user_id: "createdByUserId",
    created_at: "createdAt",
    expires_at: "expiresAt",
    accepted_at: "acceptedAt",
    accepted_by_user_id: "acceptedByUserId",
  },
  profiles: {
    user_id: "userId",
    full_name: "fullName",
    avatar_url: "avatarUrl",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  deals: {
    user_id: "userId",
    pipeline_id: "pipelineId",
    stage_id: "stageId",
    contact_id: "contactId",
    conversation_id: "conversationId",
    expected_close_date: "expectedCloseDate",
    assigned_to: "assignedTo",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  pipelines: {
    user_id: "userId",
    created_at: "createdAt",
  },
  pipeline_stages: {
    pipeline_id: "pipelineId",
    created_at: "createdAt",
  },
  automations: {
    user_id: "userId",
    trigger_type: "triggerType",
    trigger_config: "triggerConfig",
    is_active: "isActive",
    execution_count: "executionCount",
    last_executed_at: "lastExecutedAt",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  automation_steps: {
    automation_id: "automationId",
    parent_step_id: "parentStepId",
    step_type: "stepType",
    step_config: "stepConfig",
    created_at: "createdAt",
  },
  automation_logs: {
    automation_id: "automationId",
    user_id: "userId",
    contact_id: "contactId",
    trigger_event: "triggerEvent",
    steps_executed: "stepsExecuted",
    error_message: "errorMessage",
    created_at: "createdAt",
  },
  automation_pending_executions: {
    automation_id: "automationId",
    user_id: "userId",
    contact_id: "contactId",
    log_id: "logId",
    parent_step_id: "parentStepId",
    next_step_position: "nextStepPosition",
    created_at: "createdAt",
  },
  notifications: {
    account_id: "accountId",
    user_id: "userId",
    conversation_id: "conversationId",
    contact_id: "contactId",
    actor_user_id: "actorUserId",
    read_at: "readAt",
    created_at: "createdAt",
  },
  member_presence: {
    user_id: "userId",
    account_id: "accountId",
    last_seen_at: "lastSeenAt",
  },
  message_reactions: {
    message_id: "messageId",
    conversation_id: "conversationId",
    actor_type: "actorType",
    actor_id: "actorId",
    created_at: "createdAt",
  },
  custom_fields: {
    user_id: "userId",
    field_name: "fieldName",
    field_type: "fieldType",
    field_options: "fieldOptions",
    created_at: "createdAt",
  },
  contact_custom_values: {
    contact_id: "contactId",
    custom_field_id: "customFieldId",
    created_at: "createdAt",
  },
  contact_notes: {
    contact_id: "contactId",
    user_id: "userId",
    note_text: "noteText",
    created_at: "createdAt",
  },
  quick_replies: {
    user_id: "userId",
    message_text: "messageText",
    created_at: "createdAt",
  },
  ai_configs: {
    account_id: "accountId",
    created_by: "createdBy",
    api_key: "apiKey",
    system_prompt: "systemPrompt",
    is_active: "isActive",
    auto_reply_enabled: "autoReplyEnabled",
    auto_reply_max_per_conversation: "autoReplyMaxPerConversation",
    embeddings_api_key: "embeddingsApiKey",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  ai_knowledge_documents: {
    account_id: "accountId",
    created_by: "createdBy",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  ai_knowledge_chunks: {
    document_id: "documentId",
    account_id: "accountId",
    chunk_index: "chunkIndex",
    created_at: "createdAt",
  },
  ai_usage_logs: {
    account_id: "accountId",
    user_id: "userId",
    tokens_in: "tokensIn",
    tokens_out: "tokensOut",
    cost_usd: "costUsd",
    created_at: "createdAt",
  },
  flows: {
    user_id: "userId",
    trigger_type: "triggerType",
    trigger_config: "triggerConfig",
    entry_node_id: "entryNodeId",
    fallback_policy: "fallbackPolicy",
    execution_count: "executionCount",
    last_executed_at: "lastExecutedAt",
    created_at: "createdAt",
    updated_at: "updatedAt",
  },
  flow_nodes: {
    flow_id: "flowId",
    node_key: "nodeKey",
    node_type: "nodeType",
    position_x: "positionX",
    position_y: "positionY",
    created_at: "createdAt",
  },
  flow_runs: {
    flow_id: "flowId",
    user_id: "userId",
    contact_id: "contactId",
    conversation_id: "conversationId",
    current_node_key: "currentNodeKey",
    last_prompt_message_id: "lastPromptMessageId",
    reprompt_count: "repromptCount",
    started_at: "startedAt",
    last_advanced_at: "lastAdvancedAt",
    ended_at: "endedAt",
    end_reason: "endReason",
  },
  flow_run_events: {
    flow_run_id: "flowRunId",
    event_type: "eventType",
    node_key: "nodeKey",
    created_at: "createdAt",
  },
};

// ── Helpers ──────────────────────────────────────────────────────

/** Convert a Supabase-style column name to a Prisma field name. */
export function toPrismaField(table: string, column: string): string {
  const overrides = COLUMN_OVERRIDES[table];
  if (overrides?.[column]) return overrides[column];
  return snakeToCamel(column);
}

/** Resolve a Prisma model name from a database table name. */
export function toPrismaModel(table: string): string {
  return TABLE_MODEL_MAP[table] ?? snakeToCamel(table);
}

// ── Filter parsing ───────────────────────────────────────────────

type FilterOp =
  | { type: "eq"; field: string; value: unknown }
  | { type: "neq"; field: string; value: unknown }
  | { type: "gt"; field: string; value: unknown }
  | { type: "gte"; field: string; value: unknown }
  | { type: "lt"; field: string; value: unknown }
  | { type: "lte"; field: string; value: unknown }
  | { type: "in"; field: string; value: unknown[] }
  | { type: "like"; field: string; value: string }
  | { type: "ilike"; field: string; value: string }
  | { type: "isNull"; field: string };

const FILTER_RE = /^(.+)\.(eq|neq|gt|gte|lt|lte|in|like|ilike|is)$/;

export function parseFilters(
  table: string,
  searchParams: URLSearchParams,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const [key, rawValue] of searchParams.entries()) {
    const m = key.match(FILTER_RE);
    if (!m) continue;
    const [, rawCol, op] = m;
    const field = toPrismaField(table, rawCol);
    if (!field) continue;

    switch (op) {
      case "eq":
        where[field] = castValue(rawValue);
        break;
      case "neq":
        where[field] = { not: castValue(rawValue) };
        break;
      case "gt":
        where[field] = { gt: castValue(rawValue) };
        break;
      case "gte":
        where[field] = { gte: castValue(rawValue) };
        break;
      case "lt":
        where[field] = { lt: castValue(rawValue) };
        break;
      case "lte":
        where[field] = { lte: castValue(rawValue) };
        break;
      case "in":
        where[field] = { in: rawValue.split(",").map(castValue) };
        break;
      case "like":
        where[field] = { like: rawValue };
        break;
      case "ilike":
        where[field] = { contains: rawValue, mode: "insensitive" as const };
        break;
      case "is":
        if (rawValue === "null") where[field] = null;
        break;
    }
  }
  return where;
}

/** Parse `order=col.asc,col2.desc` into Prisma orderBy. */
export function parseOrderBy(
  table: string,
  orderParam: string | null,
): Record<string, string>[] {
  if (!orderParam) return [{ createdAt: "desc" }]; // default
  return orderParam.split(",").map((part) => {
    const [rawCol, dir] = part.split(".");
    const field = toPrismaField(table, rawCol);
    return { [field]: dir === "asc" ? "asc" : "desc" };
  });
}

/** Parse `select=col1,col2` into a Prisma select object. */
export function parseSelect(
  table: string,
  selectParam: string | null,
): Record<string, true> | undefined {
  if (!selectParam || selectParam === "*") return undefined;

  // If select contains PostgREST nested syntax (parentheses) or
  // aliased foreign keys (colon syntax), skip select and return all fields.
  // These require Prisma `include` which is not supported by simple select parsing.
  if (selectParam.includes("(") || selectParam.includes(":")) {
    return undefined;
  }

  const select: Record<string, true> = {};
  for (const col of selectParam.split(",")) {
    const trimmed = col.trim();
    if (!trimmed) continue;
    const field = toPrismaField(table, trimmed);
    if (field) select[field] = true;
  }
  return Object.keys(select).length > 0 ? select : undefined;
}

// ── Query builder ────────────────────────────────────────────────

export interface DataQuery {
  where: Record<string, unknown>;
  orderBy: Record<string, string>[];
  select?: Record<string, true>;
  take?: number;
  skip?: number;
  countOnly?: boolean;
  headOnly?: boolean;
}

export function buildDataQuery(
  table: string,
  searchParams: URLSearchParams,
): DataQuery {
  const where = parseFilters(table, searchParams);
  const orderBy = parseOrderBy(table, searchParams.get("order"));
  const select = parseSelect(table, searchParams.get("select"));

  const limitStr = searchParams.get("limit");
  const offsetStr = searchParams.get("offset");
  const take = limitStr ? Math.min(parseInt(limitStr, 10) || 0, 1000) : undefined;
  const skip = offsetStr ? parseInt(offsetStr, 10) || 0 : undefined;

  const countOnly = searchParams.get("count") === "exact";
  const headOnly = searchParams.get("head") === "true";

  return { where, orderBy, select, take, skip, countOnly, headOnly };
}

// ── Response helpers ─────────────────────────────────────────────

export function ok(data: unknown, count?: number) {
  const body: Record<string, unknown> = { data, error: null };
  if (count !== undefined) body.count = count;
  return Response.json(body);
}

export function err(message: string, status = 400) {
  return Response.json({ data: null, error: message }, { status });
}

// ── Internal helpers ─────────────────────────────────────────────

function castValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw !== "") return n;
  return raw;
}
