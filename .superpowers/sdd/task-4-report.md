# Task 4 Report — Migrate resolve-conversation (find-or-create by phone) to Prisma

**Status:** DONE
**Commit:** `cb3dd49` refactor(whatsapp): migrate resolve-conversation to Prisma

## What I implemented

Migrated `src/lib/whatsapp/resolve-conversation.ts` off the scripted Supabase table access onto the `prisma` singleton (`@/lib/db/prisma`), preserving the exact public signature, flow, and error semantics.

### Source changes (`resolve-conversation.ts`)
- Removed the `SupabaseClient` type import. Public signature now `resolveConversationByPhone(db: unknown, accountId, phone, name?)` — `db` is kept, typed `unknown`, and passed through to the already-Prisma-backed `resolveAuditUserId`/`findExistingContact` so not-yet-migrated callers (`/api/v1/messages` route) keep compiling.
- Config check → `prisma.whatsAppConfig.findFirst({ where: { accountId }, select: { id: true } })`.
- Contact name update → `prisma.contact.update({ where: { id }, data: { name, updatedAt: new Date() } })`.
- Contact create → `prisma.contact.create({ data: { accountId, userId: ownerUserId, phone: sanitized, name: name || sanitized }, select: { id: true } })` inside try/catch; `isUniqueViolation` (`P2002`/`23505`) → re-`findExistingContact`.
- Conversation find → `prisma.conversation.findFirst({ where: { accountId, contactId }, orderBy: { createdAt: 'asc' }, select: { id: true } })`, wrapped so a DB failure → `SendMessageError('db_error', 'Failed to resolve conversation', 500)`.
- Conversation create → `prisma.conversation.create({ data: { accountId, userId: ownerUserId, contactId }, select: { id: true } })`; on `isUniqueViolation` → re-find oldest-first (re-find failure swallowed → falls through to `'Failed to create conversation'`, matching pre-migration behavior).
- Preserved all `console.error` log prefixes and the "oldest-first, take one row / canonical survivor (issue #363)" comment intent.
- Private `findOrCreateConversationRow` param renamed to `_db: unknown` (matching the sibling helper convention).

### Test changes (`resolve-conversation.test.ts`)
- Replaced the chainable Supabase stub + mocked dedupe/contacts modules with a `vi.hoisted` + `vi.mock('@/lib/db/prisma')` prisma mock (the `send-message.test.ts` idiom).
- The real `findExistingContact` and `resolveAuditUserId` now run against the mocked prisma client, exercising the actual dedupe (`findMany` endsWith + `phonesMatch`) and audit-user resolution logic.
- 8 tests cover: bad phone → 400 before any DB call; no config → `whatsapp_not_configured`/400; existing contact + no conversation → creates conversation (asserts exact `conversation.create` args); existing contact + existing conversation → returns, no creates; contact name changed → `contact.update` with new name + `updatedAt`; no contact → creates both (asserts exact create args, `contactCreated: true`); race on contact create (P2002) → re-resolves winner; race on conversation create (P2002) → re-resolves winning conversation.

## Test results
- `npx vitest run src/lib/whatsapp/resolve-conversation.test.ts --reporter=dot` → **8 passed**
- Full suite `npx vitest run --reporter=dot` → **90 files, 832 tests passed**
- `npx tsc --noEmit` → **EXIT 0**

## Files changed
- `src/lib/whatsapp/resolve-conversation.ts` — swapped all `db.from(...)` for account-scoped Prisma calls
- `src/lib/whatsapp/resolve-conversation.test.ts` — rewritten to mock prisma, real helpers run against it

## Self-review findings
- All five swaps from the brief implemented; error family (`SendMessageError` codes/status) and log lines preserved.
- No orphaned imports; `tsc` clean proves the `unknown` signature keeps `route.ts` compiling.
- No stray restructuring: private helper still takes the (now-ignored) client arg to keep the call-site identical, consistent with the already-migrated sibling helpers.
- Added one test (contact name update) beyond the brief's list because that branch was part of the swaps and was otherwise unasserted — real behavior verified, not just mock plumbing.

## Issues / concerns
- None blocking. Minor note: `prisma.whatsAppConfig.findFirst` now uses `select: { id: true }` (mirrors the original `.select('id')`), slightly narrower than the brief's literal `{ where: { accountId } }` — intentional and behavior-identical.
