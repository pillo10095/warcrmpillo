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

