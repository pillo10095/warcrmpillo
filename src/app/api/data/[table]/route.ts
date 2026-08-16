import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getSessionUser } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import {
  buildDataQuery,
  toPrismaModel,
  toWireShape,
  snakeToCamel,
  ok,
  err,
} from "@/lib/api/data/query-builder";

export const runtime = "nodejs";

// ── Tables that have account_id for tenant scoping ───────────────
const ACCOUNT_SCOPED = new Set([
  "contacts",
  "tags",
  "conversations",
  "whatsapp_config",
  "message_templates",
  "broadcasts",
  "broadcast_recipients",
  "api_keys",
  "webhook_endpoints",
  "files",
  "account_invitations",
  "invitations",
  "notifications",
  "member_presence",
  "ai_configs",
  "ai_knowledge_documents",
  "ai_knowledge_chunks",
  "ai_usage_logs",
]);

// Tables scoped by user_id (the user's own data)
const USER_SCOPED = new Set([
  "profiles",
  "pipelines",
  "automations",
  "automation_steps",
  "automation_logs",
  "automation_pending_executions",
  "custom_fields",
  "quick_replies",
  "flows",
  "flow_nodes",
  "flow_runs",
  "flow_run_events",
]);

// Tables that don't have userId/accountId directly but are scoped
// through a parent relation (e.g. pipeline_stages → pipeline → user)
const RELATIONALLY_SCOPED: Record<string, { relation: string; parentField: string }> = {
  pipeline_stages: { relation: "pipeline", parentField: "userId" },
  // message_reactions has no account_id column — scope through its
  // conversation relation instead (conversation_id → conversation.account_id).
  message_reactions: { relation: "conversation", parentField: "accountId" },
  // contact_tags has no account_id column either — scope through
  // contact → account (contact_tags → contact.account_id).
  contact_tags: { relation: "contact", parentField: "accountId" },
  // openwa_sessions has no account_id — scope through its config.
  openwa_sessions: { relation: "config", parentField: "accountId" },
  // openwa_configs has no account_id — scope through its account relation.
  openwa_configs: { relation: "account", parentField: "accountId" },
};

// Tables that are NOT scoped (system / cross-account)
const UNSCOPED = new Set(["users", "sessions", "accounts", "account_members"]);

// ── Auth helper ──────────────────────────────────────────────────

async function authenticate() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table } = await params;
  const model = toPrismaModel(table);
  if (!model) return err(`Unknown table: ${table}`, 404);

  const user = await authenticate();
  if (!user) return err("Unauthorized", 401);

  const { where, orderBy, select, include, take, skip, countOnly, headOnly } =
    buildDataQuery(table, request.nextUrl.searchParams);

  // The client query-builder sends `.limit(n)` / `.range(a,b)` as an
  // HTTP `Range: a-b` header (PostgREST convention), while `buildDataQuery`
  // reads `limit`/`offset` query params. Honor the header too so page
  // sizes are actually applied.
  const rangeHeader = request.headers.get("range");
  let effectiveTake = take;
  let effectiveSkip = skip;
  if (rangeHeader) {
    const m = rangeHeader.match(/^(\d+)-(\d+)$/);
    if (m) {
      const from = parseInt(m[1], 10);
      const to = parseInt(m[2], 10);
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
        effectiveSkip = from;
        effectiveTake = Math.min(to - from + 1, 1000);
      }
    }
  }

  // Apply tenant scoping
  if (ACCOUNT_SCOPED.has(table)) {
    where.accountId = user.accountId;
  } else if (USER_SCOPED.has(table)) {
    where.userId = user.userId;
  } else if (RELATIONALLY_SCOPED[table]) {
    const { relation, parentField } = RELATIONALLY_SCOPED[table];
    // parentField is either "accountId" or "userId" on the parent model.
    where[relation] = { [parentField]: parentField === "accountId" ? user.accountId : user.userId };
  }

  try {
    const prismaModel = (prisma as any)[model];
    if (!prismaModel) return err(`Unknown model: ${model}`, 404);

    // Count-only query
    if (countOnly || headOnly) {
      const count = await prismaModel.count({ where });
      return ok([], count, count);
    }

    const query: Record<string, unknown> = { where, orderBy };
    if (select) query.select = select;
    if (include) query.include = include;
    if (effectiveTake !== undefined) query.take = effectiveTake;
    if (effectiveSkip !== undefined) query.skip = effectiveSkip;

    const rows = await prismaModel.findMany(query);
    const count = (effectiveTake !== undefined || effectiveSkip !== undefined)
      ? await prismaModel.count({ where })
      : undefined;

    return ok(toWireShape(rows), count);
  } catch (e: any) {
    return err(e.message ?? "Query failed", 500);
  }
}

// ── POST (insert) ───────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table } = await params;
  const model = toPrismaModel(table);
  if (!model) return err(`Unknown table: ${table}`, 404);

  const user = await authenticate();
  if (!user) return err("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  if (!body) return err("Invalid JSON body");

  try {
    const prismaModel = (prisma as any)[model];
    if (!prismaModel) return err(`Unknown model: ${model}`, 404);

    const isArray = Array.isArray(body);
    const items = isArray ? body : [body];

    // Convert snake_case wire keys → Prisma camelCase fields
    // (e.g. `phone_normalized` → `phoneNormalized`).
    for (const item of items) {
      for (const key of Object.keys(item)) {
        const camel = snakeToCamel(key);
        if (camel !== key) {
          item[camel] = item[key];
          delete item[key];
        }
      }
    }

    // Inject tenant scope
    for (const item of items) {
      if (ACCOUNT_SCOPED.has(table)) {
        item.accountId = user.accountId;
      } else if (USER_SCOPED.has(table)) {
        item.userId = user.userId;
      }
    }

    const result = isArray
      ? await prismaModel.createMany({ data: items, skipDuplicates: true })
      : await prismaModel.create({ data: items[0] });

    // If select is requested, return the created row(s) — mimics Supabase insert().select()
    const { select } = buildDataQuery(table, request.nextUrl.searchParams);
    if (select) {
      if (isArray) {
        // createMany doesn't return rows — query back by IDs if possible
        return ok([], result.count);
      } else {
        // Return the created row directly from create()
        return ok(toWireShape(result));
      }
    }

    return ok(toWireShape(result), isArray ? result.count : undefined);
  } catch (e: any) {
    return err(e.message ?? "Insert failed", 500);
  }
}

// ── PATCH (update) ──────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table } = await params;
  const model = toPrismaModel(table);
  if (!model) return err(`Unknown table: ${table}`, 404);

  const user = await authenticate();
  if (!user) return err("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return err("Invalid JSON body");

  const { where: filterWhere } = buildDataQuery(table, request.nextUrl.searchParams);

  // Apply tenant scoping on the filter
  if (ACCOUNT_SCOPED.has(table)) {
    filterWhere.accountId = user.accountId;
  } else if (USER_SCOPED.has(table)) {
    filterWhere.userId = user.userId;
  } else if (RELATIONALLY_SCOPED[table]) {
    const { relation, parentField } = RELATIONALLY_SCOPED[table];
    filterWhere[relation] = { [parentField]: parentField === "accountId" ? user.accountId : user.userId };
  }

  try {
    const prismaModel = (prisma as any)[model];
    if (!prismaModel) return err(`Unknown model: ${model}`, 404);

    // Strip tenant fields from the update data
    const data = { ...body };
    if (ACCOUNT_SCOPED.has(table)) delete data.accountId;
    if (USER_SCOPED.has(table)) delete data.userId;
    delete data.id; // never allow PK override

    // Convert snake_case wire keys → Prisma camelCase fields
    // (e.g. `unread_count` → `unreadCount`, `read_at` → `readAt`).
    for (const key of Object.keys(data)) {
      const camel = snakeToCamel(key);
      if (camel !== key) {
        data[camel] = data[key];
        delete data[key];
      }
    }

    const result = await prismaModel.updateMany({
      where: filterWhere,
      data,
    });

    return ok(result);
  } catch (e: any) {
    return err(e.message ?? "Update failed", 500);
  }
}

// ── DELETE ──────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table } = await params;
  const model = toPrismaModel(table);
  if (!model) return err(`Unknown table: ${table}`, 404);

  const user = await authenticate();
  if (!user) return err("Unauthorized", 401);

  const { where: filterWhere } = buildDataQuery(table, request.nextUrl.searchParams);

  // Apply tenant scoping
  if (ACCOUNT_SCOPED.has(table)) {
    filterWhere.accountId = user.accountId;
  } else if (USER_SCOPED.has(table)) {
    filterWhere.userId = user.userId;
  } else if (RELATIONALLY_SCOPED[table]) {
    const { relation, parentField } = RELATIONALLY_SCOPED[table];
    filterWhere[relation] = { [parentField]: parentField === "accountId" ? user.accountId : user.userId };
  }

  try {
    const prismaModel = (prisma as any)[model];
    if (!prismaModel) return err(`Unknown model: ${model}`, 404);

    const result = await prismaModel.deleteMany({ where: filterWhere });
    return ok(result);
  } catch (e: any) {
    return err(e.message ?? "Delete failed", 500);
  }
}
