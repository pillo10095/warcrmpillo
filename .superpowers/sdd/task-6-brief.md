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

