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

