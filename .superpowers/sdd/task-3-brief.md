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

