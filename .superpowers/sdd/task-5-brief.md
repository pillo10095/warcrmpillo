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

