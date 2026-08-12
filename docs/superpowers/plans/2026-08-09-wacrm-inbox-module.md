# WACRM Supabase → MySQL: Sub-proyecto Inbox (conversations + messages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the conversations + messages surface of the inbox module off Supabase and onto the MySQL/Prisma foundation — the shared outbound-send core, the find-or-create conversation path, and the public `/api/v1/conversations` + `/api/v1/messages` endpoints. At the end, no Supabase import remains in the files this sub-project touches.

**Architecture (mirrors the completed contacts sub-project):** keep public signatures' leading `db`/`_db` param so not-yet-migrated callers (webhook, dashboard routes) keep compiling; query the `prisma` singleton directly inside; every query explicitly scoped by `accountId` (application-level RLS replacement). Wire-shape types (`@/types`) stay snake_case; Prisma rows are camelCase, so thin mappers convert Prisma rows → `@/types` rows at the boundary.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, MySQL 8.0.17 (AppServ local, `mysql8` service), Prisma 6.19.3, Vitest.

## Scope

**In scope — conversations + messages (design order step 6):**
- `prisma/schema.prisma` — no new model for this sub-project (`MessageReaction` deferred to the react/webhook sub-project).
- `src/lib/inbox/conversations.ts` — add a Prisma `CONVERSATION_INCLUDE` + `prismaToConversation` mapper (the existing Supabase helpers stay for the dashboard client).
- New `src/lib/inbox/messages.ts` — `prismaToMessage` mapper.
- `src/lib/whatsapp/send-message.ts` — swap SupabaseClient for Prisma.
- New `src/lib/flows/pause-on-agent-send.ts` — extract the flow-run pause so `send-message.ts` has zero `@supabase/*` imports.
- New `src/lib/whatsapp/template-row-mapper.ts` — map Prisma `MessageTemplate` row → `@/types` snake_case row for the send-builder.
- `src/lib/whatsapp/resolve-conversation.ts` — swap to Prisma.
- v1 routes: `GET /api/v1/conversations`, `GET /api/v1/conversations/[id]`, `GET /api/v1/conversations/[id]/messages`, `POST /api/v1/messages`.

**Out of scope (deferred, with rationale):**
- Dashboard routes `/api/whatsapp/send`, `/api/whatsapp/react`, `/api/whatsapp/media/[mediaId]` — coupled to the dashboard UI + realtime + `message_reactions`, which migrate with the realtime/webhook sub-projects (design steps 7–8). Kept on Supabase for now, exactly like the dashboard `/api/contacts` routes were kept in the contacts sub-project.
- `src/lib/conversations/reopen.ts`, `src/lib/whatsapp/template-webhook.ts` — called only by the deferred webhook route; they still receive the Supabase admin client. No `@supabase/*` import lives inside them (the client is passed in), so they don't block independence.
- The webhook route itself, broadcast/automations/flows/AI, dashboard UI + realtime (SSE).

## Global Constraints

- `DATABASE_URL=mysql://root:@localhost:3306/wacrm` — lives in `.env.local`. Prisma CLI needs it set explicitly in the shell:
  `$env:DATABASE_URL="mysql://root:@localhost:3306/wacrm"`
- Every query MUST be account-scoped — the `accountId` guard is non-negotiable.
- No `@supabase/*` imports remain in the files this sub-project touches.
- Keep `*.test.ts` beside code; Vitest runner (`npm test` = `vitest run`). Full suite must stay green (810 tests at last count) and `npx tsc --noEmit` must pass with EXIT 0.
- Wire types (`@/types`) are snake_case; Prisma rows are camelCase — map at the boundary, don't leak camelCase onto the wire.
- `isMessageTemplate` guard expects snake_case fields (`user_id`, `body_text`) — feed it a mapped row.
- Commit per task (work-unit-commits). Conventional commits only, no AI attribution.

---

### Task 1: Prisma row mappers for conversations + messages

**Files:**
- Modify: `src/lib/inbox/conversations.ts` (add `CONVERSATION_INCLUDE` + `prismaToConversation`)
- Create: `src/lib/inbox/messages.ts`
- Create: `src/lib/inbox/messages.test.ts`
- Modify: `src/lib/inbox/conversations.test.ts` (add mapper tests)

**Interfaces:**
- Produces: `CONVERSATION_INCLUDE: Prisma.ConversationInclude` (contact + contactTags + tag), `prismaToConversation(row): Conversation` (wire type, tags flattened), `prismaToMessage(row): Message`.

- [ ] **Step 1: Add the Prisma include + conversation mapper**

In `src/lib/inbox/conversations.ts`, add (type-only import so the dashboard client isn't pulled server-only):

```ts
import type { Prisma, Conversation as PrismaConversation } from '@prisma/client';
import type { Conversation } from '@/types';

/** Prisma include that embeds the contact + its tags — the MySQL
 *  replacement for the Supabase CONVERSATION_SELECT string. */
export const CONVERSATION_INCLUDE = {
  contact: { include: { contactTags: { include: { tag: true } } } },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;

/** Map a Prisma conversation row (camelCase, nested contactTags) into
 *  the snake_case wire `Conversation` shape — same output the Supabase
 *  `normalizeConversation` produced, so v1 serializers see no change. */
export function prismaToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    user_id: row.userId,
    contact_id: row.contactId,
    status: row.status,
    assigned_agent_id: row.assignedAgentId ?? undefined,
    last_message_text: row.lastMessageText ?? undefined,
    last_message_at: row.lastMessageAt?.toISOString() ?? undefined,
    unread_count: row.unreadCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    contact: row.contact
      ? {
          id: row.contact.id,
          user_id: row.contact.userId,
          account_id: row.contact.accountId,
          phone: row.contact.phone,
          phone_normalized: row.contact.phoneNormalized ?? undefined,
          name: row.contact.name ?? undefined,
          email: row.contact.email ?? undefined,
          company: row.contact.company ?? undefined,
          avatar_url: row.contact.avatarUrl ?? undefined,
          created_at: row.contact.createdAt.toISOString(),
          updated_at: row.contact.updatedAt.toISOString(),
          tags: (row.contact.contactTags ?? [])
            .map((ct) => ct.tag)
            .filter((t): t is NonNullable<typeof ct.tag> => t != null)
            .map((t) => ({
              id: t.id,
              user_id: t.userId,
              name: t.name,
              color: t.color,
              created_at: t.createdAt.toISOString(),
            })),
        }
      : undefined,
  };
}
```

- [ ] **Step 2: Create the message mapper**

Create `src/lib/inbox/messages.ts`:

```ts
import type { Prisma } from '@prisma/client';
import type { Message } from '@/types';

type MessageRow = Prisma.MessageGetPayload<Record<string, never>>;

/** Map a Prisma message row (camelCase) into the snake_case wire
 *  `Message` shape consumed by the v1 serializer. */
export function prismaToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    sender_type: row.senderType,
    sender_id: row.senderId ?? undefined,
    content_type: row.contentType,
    content_text: row.contentText ?? undefined,
    media_url: row.mediaUrl ?? undefined,
    template_name: row.templateName ?? undefined,
    message_id: row.messageId ?? undefined,
    status: row.status,
    reply_to_message_id: row.replyToMessageId ?? undefined,
    interactive_reply_id: row.interactiveReplyId ?? undefined,
    interactive_payload: (row.interactivePayload as Message['interactive_payload']) ?? undefined,
    ai_generated: row.aiGenerated,
    created_at: row.createdAt.toISOString(),
  };
}
```

- [ ] **Step 3: Write mapper tests**

In `src/lib/inbox/conversations.test.ts` add `prismaToConversation` tests: flattens `contactTags[].tag` into `contact.tags`, maps camelCase→snake_case, handles a null contact. In the new `messages.test.ts` test `prismaToMessage`: camelCase→snake_case, `messageId → message_id`, null-optional handling.

- [ ] **Verify:** `npx vitest run src/lib/inbox --reporter=dot` green; `npx tsc --noEmit` clean.

- [ ] **Commit:** `feat(inbox): add Prisma row mappers for conversations and messages`

---

### Task 2: Extract the flow-run pause out of send-message

**Files:**
- Create: `src/lib/flows/pause-on-agent-send.ts`
- Modify: `src/lib/whatsapp/send-message.ts` (import it, delete the inline `supabaseAdmin()` block)

**Why:** `send-message.ts` must end with zero `@supabase/*` imports. The flow-run pause is flows-domain (its table `flow_runs` isn't in Prisma until the flows sub-project) — keep it alive behind a flows-module function that still uses `supabaseAdmin`.

- [ ] **Step 1: Create the flows helper**

```ts
import { supabaseAdmin } from './admin-client';

/**
 * Pause active Flow runs for a contact — the "agent stepped in" signal.
 * Best-effort: a failure must never break the send path. Flows still
 * run on Supabase until the flows sub-project migrates; this module is
 * the seam where that swap happens.
 */
export async function pauseActiveFlowRuns(
  accountId: string,
  contactId: string
): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active');
    if (error) {
      console.error('[flows] pause-on-agent-send failed:', error.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }
}
```

- [ ] **Step 2: Swap the call in send-message.ts**

Delete the inline `try { supabaseAdmin().from('flow_runs')... }` block and the `supabaseAdmin` import; call `await pauseActiveFlowRuns(accountId, contact.id)`.

- [ ] **Verify:** `npx vitest run src/lib/whatsapp/send-message.test.ts --reporter=dot` green; `npx tsc --noEmit` clean; grep shows no `@supabase` in `send-message.ts`.

- [ ] **Commit:** `refactor(flows): extract pause-on-agent-send helper`

---

### Task 3: Migrate the outbound send core to Prisma

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts`
- Modify: `src/lib/whatsapp/send-message.test.ts`

**Approach:** keep the `db` parameter on the public signature (`sendMessageToConversation(db, accountId, params)`) so callers keep compiling, but ignore it — query `prisma` directly, scoped by `accountId`. Swap these Supabase calls:

| Supabase (today) | Prisma (tomorrow) |
|---|---|
| `.from('conversations').select('*, contact:contacts(*)').eq('id',…).eq('account_id',…).single()` | `prisma.conversation.findFirst({ where: { id: conversationId, accountId }, include: { contact: true } })` |
| `.from('whatsapp_config').select('*').eq('account_id',…).single()` | `prisma.whatsAppConfig.findUnique({ where: { accountId } })` |
| legacy-token update | `prisma.whatsAppConfig.update({ where: { id: config.id }, data: { accessToken: encrypt(accessToken) } })` |
| reply-parent lookup | `prisma.message.findFirst({ where: { id: replyToMessageId, conversationId }, select: { messageId: true } })` |
| `.from('message_templates').select('*').eq('account_id',…).eq('name',…).eq('language',…).maybeSingle()` | `prisma.messageTemplate.findFirst({ where: { accountId, name: templateName, language: templateLanguage || 'en_US' } })` |
| contact phone auto-correct update | `prisma.contact.update({ where: { id: contact.id }, data: { phone: workingPhone } })` |
| `.from('messages').insert({...}).select().single()` | `prisma.message.create({ data: { conversationId, senderType: 'agent', contentType, contentText, mediaUrl, templateName, interactivePayload, messageId, status: 'sent', replyToMessageId } })` |
| conversation last-message update | `prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageText, lastMessageAt, updatedAt } })` |

- [ ] **Step 1: Replace the header imports**

Drop `import type { SupabaseClient } from '@supabase/supabase-js'`; add `import { prisma } from '@/lib/db/prisma';` and `import { pauseActiveFlowRuns } from '@/lib/flows/pause-on-agent-send';` and `import { prismaTemplateToMessage } from '@/lib/whatsapp/template-row-mapper';`.

- [ ] **Step 2: Conversation + contact load**

```ts
const conversation = await prisma.conversation.findFirst({
  where: { id: conversationId, accountId },
  include: { contact: true },
});
if (!conversation) throw new SendMessageError('not_found', 'Conversation not found', 404);
const contact = conversation.contact;
```

- [ ] **Step 3: WhatsApp config + legacy upgrade**

```ts
const config = await prisma.whatsAppConfig.findUnique({ where: { accountId } });
if (!config) throw new SendMessageError('whatsapp_not_configured', '...', 400);
const accessToken = decrypt(config.accessToken);
if (isLegacyFormat(config.accessToken)) {
  void prisma.whatsAppConfig
    .update({ where: { id: config.id }, data: { accessToken: encrypt(accessToken) } })
    .catch((err) => console.warn('[send-message] access_token GCM upgrade failed:', err));
}
```

Note: `config.phone_number_id` and `config.access_token` become `config.phoneNumberId` / `config.accessToken` throughout the `attempt` closure.

- [ ] **Step 4: Reply-parent lookup**

```ts
if (replyToMessageId) {
  const parent = await prisma.message.findFirst({
    where: { id: replyToMessageId, conversationId },
    select: { messageId: true },
  });
  if (!parent) throw new SendMessageError('bad_request', 'reply_to_message_id not found in this conversation', 400);
  if (!parent.messageId) { console.warn('...'); } else { contextMessageId = parent.messageId; }
}
```

- [ ] **Step 5: Template row**

```ts
if (messageType === 'template' && templateName) {
  const row = await prisma.messageTemplate.findFirst({
    where: { accountId, name: templateName, language: templateLanguage || 'en_US' },
  });
  if (row) {
    const mapped = prismaTemplateToMessage(row);
    if (!isMessageTemplate(mapped)) throw new SendMessageError('template_malformed', '...', 500);
    templateRow = mapped;
  }
}
```

- [ ] **Step 6: Phone auto-correct + message insert + conversation touch**

Replace the `db.from('contacts').update(...)`, `.from('messages').insert(...)`, and `.from('conversations').update(...)` calls with the Prisma equivalents from the table above. `interactivePayload` is a `Json` field — pass the plain object. Map the insert error to the existing `'db_error'` / 500 SendMessageError.

- [ ] **Step 7: Rewrite the test to mock prisma**

The current test's `noDb()` explodes-if-touched stub is obsolete. Mock `@/lib/db/prisma` with `vi.mock` and assert:
- Invalid params short-circuit with the matching `SendMessageError` WITHOUT calling `prisma.conversation.findFirst`.
- Valid params reach `prisma.conversation.findFirst` (mock returns a conversation + contact); missing config → `whatsapp_not_configured`; valid config + Meta mock → message created + conversation updated.
- Keep the `SendMessageError` code/status tests.

- [ ] **Verify:** `npx vitest run src/lib/whatsapp/send-message.test.ts --reporter=dot` green; full `npx vitest run --reporter=dot` green; `npx tsc --noEmit` EXIT 0.

- [ ] **Commit:** `refactor(whatsapp): migrate outbound send core to Prisma`

---

### Task 4: Migrate resolve-conversation (find-or-create by phone) to Prisma

**Files:**
- Modify: `src/lib/whatsapp/resolve-conversation.ts`
- Modify: `src/lib/whatsapp/resolve-conversation.test.ts`

- [ ] **Step 1: Swap config check + contact create/update**

Replace every `db.from(...)` in `resolveConversationByPhone` and `findOrCreateConversationRow` with account-scoped Prisma calls, keeping the same race-handling semantics (`isUniqueViolation` already accepts `P2002` + legacy `23505`):

- config check → `prisma.whatsAppConfig.findFirst({ where: { accountId } })`
- contact update (name changed) → `prisma.contact.update({ where: { id: existing.id }, data: { name, updatedAt } })`
- contact create → `prisma.contact.create({ data: { accountId, userId: ownerUserId, phone: sanitized, name: name || sanitized } })`, catch `isUniqueViolation` → re-`findExistingContact`
- conversation find → `prisma.conversation.findFirst({ where: { accountId, contactId }, orderBy: { createdAt: 'asc' } })`
- conversation create → `prisma.conversation.create({ data: { accountId, userId: ownerUserId, contactId } })`, catch `isUniqueViolation` → re-find

`resolveAuditUserId` and `findExistingContact` are already Prisma-backed (`_db: unknown`) — keep passing the (now-ignored) `db` through.

- [ ] **Step 2: Rewrite the test to mock prisma**

Replace the chainable Supabase mock with a `prisma` mock (`@/lib/db/prisma`). Cover: bad phone → 400; no config → `whatsapp_not_configured`; existing contact + no conversation → creates conversation; existing contact + existing conversation → returns it; race on contact create (P2002) → re-resolves.

- [ ] **Verify:** `npx vitest run src/lib/whatsapp/resolve-conversation.test.ts --reporter=dot` green; full suite green; `npx tsc --noEmit` EXIT 0.

- [ ] **Commit:** `refactor(whatsapp): migrate resolve-conversation to Prisma`

---

### Task 5: Migrate v1 conversations routes to Prisma

**Files:**
- Modify: `src/app/api/v1/conversations/route.ts`
- Modify: `src/app/api/v1/conversations/[id]/route.ts`
- Modify: `src/app/api/v1/conversations/[id]/messages/route.ts`
- Create: route tests for each (mirror `src/app/api/v1/contacts/route.test.ts` pattern)

**Pattern:** mirror the migrated contacts route — `requireApiKey(request, scope)` for auth (returns `accountId`; `ctx.supabase` is a null stub), build `Prisma.*WhereInput` with the keyset OR, `take: limit + 1`, `orderBy`, then feed `prismaToConversation` / `prismaToMessage` into the existing serializers.

- [ ] **Step 1: GET /api/v1/conversations (list)**

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { CONVERSATION_INCLUDE, prismaToConversation } from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';

// inside GET, after parseListParams + filters:
const and: Prisma.ConversationWhereInput[] = [];
if (status) and.push({ status: status as ConversationStatus });
if (contactId) and.push({ contactId });
if (cursor) {
  const at = new Date(cursor.createdAt);
  and.push({ OR: [ { createdAt: { lt: at } }, { AND: [{ createdAt: at }, { id: { lt: cursor.id } }] } ] });
}
const rows = await prisma.conversation.findMany({
  where: { accountId: ctx.accountId, ...(and.length ? { AND: and } : {}) },
  include: CONVERSATION_INCLUDE,
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: limit + 1,
});
const { items, nextCursor } = buildPage(
  rows.map((r) => ({ created_at: r.createdAt.toISOString(), id: r.id })),
  limit
);
const byId = new Map(rows.map((r) => [r.id, r]));
return okList(
  items.map((r) => serializeConversation(prismaToConversation(byId.get(r.id)!))),
  nextCursor
);
```

Keep the `error` → `fail('internal', ...)` wrap and the `toApiErrorResponse(err)` catch. Update the header comment to "Prisma-backed".

- [ ] **Step 2: GET /api/v1/conversations/[id]**

```ts
const row = await prisma.conversation.findFirst({
  where: { id, accountId: ctx.accountId },
  include: CONVERSATION_INCLUDE,
});
if (!row) return fail('not_found', 'Conversation not found', 404);
return ok(serializeConversation(prismaToConversation(row)));
```

- [ ] **Step 3: GET /api/v1/conversations/[id]/messages**

Ownership gate first, then the keyset walk:

```ts
const conv = await prisma.conversation.findFirst({
  where: { id, accountId: ctx.accountId },
  select: { id: true },
});
if (!conv) return fail('not_found', 'Conversation not found', 404);

const where: Prisma.MessageWhereInput = { conversationId: id };
if (cursor) {
  const at = new Date(cursor.createdAt);
  where.OR = [ { createdAt: { lt: at } }, { AND: [{ createdAt: at }, { id: { lt: cursor.id } }] } ];
}
const rows = await prisma.message.findMany({
  where,
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: limit + 1,
});
const { items, nextCursor } = buildPage(
  rows.map((r) => ({ created_at: r.createdAt.toISOString(), id: r.id })),
  limit
);
const byId = new Map(rows.map((r) => [r.id, r]));
return okList(items.map((r) => serializeMessage(prismaToMessage(byId.get(r.id)!))), nextCursor);
```

- [ ] **Step 4: Write route tests**

Create `route.test.ts` beside each route (mock `@/lib/auth/api-context` `requireApiKey` + `@/lib/db/prisma`), following `src/app/api/v1/contacts/route.test.ts` conventions. Cover: list filters status/contact_id + cursor paging; 404 on foreign id; ownership 404 on messages of a foreign conversation; keyset `next_cursor`.

- [ ] **Verify:** new route tests green; `npx vitest run --reporter=dot` full suite green; `npx tsc --noEmit` EXIT 0.

- [ ] **Commit:** `feat(v1): migrate conversations and messages routes to Prisma`

---

### Task 6: Migrate POST /api/v1/messages to Prisma

**Files:**
- Modify: `src/app/api/v1/messages/route.ts`
- Create: `src/app/api/v1/messages/route.test.ts`

- [ ] **Step 1: Pass through the shared libs**

`resolveConversationByPhone` and `sendMessageToConversation` now ignore their first arg. Change the call sites from `ctx.supabase` to `undefined`:

```ts
const resolved = await resolveConversationByPhone(undefined, ctx.accountId, to, name ?? null);
const result = await sendMessageToConversation(undefined, ctx.accountId, { ... });
```

Remove the `ctx.supabase` mentions in comments; keep `requireApiKey(request, 'messages:send')`. No other logic changes — validation, template unpacking, error mapping stay as-is.

- [ ] **Step 2: Write a route test**

Mock `@/lib/auth/api-context`, `@/lib/whatsapp/resolve-conversation`, `@/lib/whatsapp/send-message` (or mock prisma end-to-end like the contacts route tests). Cover: missing `to` → 400; invalid type → 400 before any resolve; valid text send → 201 with `{ message_id, whatsapp_message_id, conversation_id, contact_id, contact_created }`; `SendMessageError` → mapped envelope.

- [ ] **Verify:** `npx vitest run src/app/api/v1/messages --reporter=dot` green; full suite green; `npx tsc --noEmit` EXIT 0.

- [ ] **Commit:** `feat(v1): migrate messages send route to Prisma`

---

### Task 7: Final verification + Supabase-import sweep

- [ ] **Step 1: Full test run**

`npm test` (vitest run). All suites green (810+ tests).

- [ ] **Step 2: Typecheck**

`npx tsc --noEmit` → EXIT 0.

- [ ] **Step 3: Sweep migrated files**

`rg "@supabase/supabase-js" src/lib/whatsapp/send-message.ts src/lib/whatsapp/resolve-conversation.ts src/lib/inbox src/app/api/v1/conversations src/app/api/v1/messages` → no matches.

- [ ] **Step 4: Confirm working tree clean and commit**

`git status` clean after the Task 6 commit.

- [ ] **Commit:** `chore: complete inbox conversations + messages Prisma migration` (only if anything remains uncommitted)

---

## Risks / Notes

- **Dual-source transition:** the dashboard inbox UI still reads via Supabase realtime until the SSE sub-project (design step 7); the webhook still writes to Supabase. During this window `/api/v1` conversations/messages are MySQL-backed while the dashboard is Supabase-backed — acceptable and consistent with the staged design and the contacts sub-project precedent.
- **`MessageReaction`** deliberately deferred — the react route + webhook reactions migrate together later.
- **Template row mapping:** Prisma returns camelCase; the send-builder + `isMessageTemplate` expect snake_case. The `template-row-mapper` closes that gap — do NOT "simplify" by changing the wire type.
- **Keyset cursor:** reuse the exact `(created_at desc, id desc)` OR-group from the contacts route — the two orders must stay identical or pagination skips rows.
- **Race handling:** keep `isUniqueViolation` (P2002 + 23505) re-resolve logic in resolve-conversation — the unique index still rejects concurrent creates.
