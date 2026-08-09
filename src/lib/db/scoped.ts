import type { PrismaClient } from "@prisma/client";

/** Models that carry an accountId column and MUST be scoped by account. */
const SCOPED_MODELS = new Set([
  "message", "conversation", "contact", "tag", "contactTag", "customField",
  "contactCustomValue", "contactNote", "broadcast", "broadcastRecipient",
  "messageTemplate", "pipeline", "pipelineStage", "deal", "automation",
  "automationStep", "automationLog", "flow", "flowNode", "flowRun",
  "flowRunEvent", "quickReply", "notification", "webhookEndpoint", "apiKey",
  "aiConfig", "aiKnowledgeDocument", "aiUsageLog", "fileRecord",
]);

function scopeWhere(model: string, where: Record<string, unknown> | undefined, accountId: string) {
  if (!SCOPED_MODELS.has(model)) return where;
  return { ...(where ?? {}), accountId };
}

/**
 * Wraps a Prisma client so every query on account-scoped models
 * automatically gets `accountId` injected into `where`.
 * This is the application-level replacement for Supabase RLS.
 */
export function withAccountScope<T extends Record<string, any>>(
  accountId: string,
  prisma: T,
): T {
  const scoped = {} as T;
  for (const key of Object.keys(prisma)) {
    const model = key as keyof T;
    const delegate = prisma[model];
    if (!delegate || typeof delegate !== "object") {
      scoped[model] = delegate;
      continue;
    }
    const wrapped: Record<string, unknown> = {};
    for (const method of ["findMany", "findFirst", "findUnique", "update", "updateMany", "delete", "deleteMany", "count", "aggregate", "groupBy"]) {
      const original = (delegate as any)[method];
      if (typeof original !== "function") continue;
      wrapped[method] = (args: any) => {
        if (method === "findUnique" || method === "delete") {
          const where = args?.where ?? args;
          const scopedArgs = {
            ...args,
            where: scopeWhere(model as string, { id: where?.id ?? where }, accountId),
          };
          return original.call(delegate, scopedArgs);
        }
        const scopedArgs = { ...args, where: scopeWhere(model as string, args?.where, accountId) };
        return original.call(delegate, scopedArgs);
      };
    }
    scoped[model] = wrapped as any;
  }
  return scoped;
}

export const ACCOUNT_SCOPED_MODELS = SCOPED_MODELS;
