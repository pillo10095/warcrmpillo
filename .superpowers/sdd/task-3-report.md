# Task 3 Report — Migrate outbound send core to Prisma

## What I implemented

Migrated `sendMessageToConversation` in `src/lib/whatsapp/send-message.ts` from Supabase table access to the Prisma singleton, following the swap table in the task brief:

| Supabase (before) | Prisma (after) |
|---|---|
| `conversations` select + contact embed | `prisma.conversation.findFirst({ where: { id, accountId }, include: { contact: true } })` |
| `whatsapp_config` select | `prisma.whatsAppConfig.findUnique({ where: { accountId } })` |
| legacy CBC token upgrade | `prisma.whatsAppConfig.update({ where: { id }, data: { accessToken: encrypt(...) } })` (fire-and-forget `.catch`) |
| reply-parent lookup | `prisma.message.findFirst({ where: { id, conversationId }, select: { messageId } })` |
| `message_templates` lookup | `prisma.messageTemplate.findFirst({ where: { accountId, name, language } })` |
| contact phone auto-correct | `prisma.contact.update({ where: { id }, data: { phone } })` |
| `messages` insert | `prisma.message.create(...)` (errors → `db_error` / 500) |
| `conversations` last-message update | `prisma.conversation.update({ where: { id }, data: { lastMessageText, lastMessageAt, updatedAt } })` |

Key details:
- Signature keeps the leading arg as `_db: unknown` (ignored) so `send/route.ts` and the v1 messages route keep compiling; the `SupabaseClient` type import was dropped per Step 1. `config.phone_number_id` / `config.access_token` → `config.phoneNumberId` / `config.accessToken` throughout the `attempt` closure.
- **Created** `src/lib/whatsapp/template-row-mapper.ts` (per brief): `prismaTemplateToMessage` maps a Prisma `MessageTemplate` row (camelCase) → the `@/types` snake_case `MessageTemplate` shape, then `isMessageTemplate` guards it (it expects `user_id`, `body_text` — the raw Prisma row would fail that guard, so mapping happens first).
- The `interactivePayload` Json column on MySQL accepts `Prisma.DbNull` (SQL NULL) rather than plain `null`; the interactive payload is cast via `as unknown as Prisma.InputJsonValue` (the payload interfaces lack the implicit index signature TS needs for `InputJsonValue`).

## Test results

- `npx vitest run src/lib/whatsapp/send-message.test.ts --reporter=dot` → **21/21 passed** (rewritten to mock `@/lib/db/prisma` via `vi.hoisted` + `vi.mock`, following the `contacts.test.ts` pattern). It asserts real behavior:
  - Invalid params short-circuit with matching `SendMessageError` **without** calling `prisma.conversation.findFirst`.
  - Valid params reach `findFirst` (conversation not found → 404; contact no phone → 400; invalid E.164 → 400).
  - Missing config → `whatsapp_not_configured`.
  - Success path: Meta send called with decrypted token + digits-only phone, `message.create` called with the exact payload, `conversation.update` with last-message fields, `pauseActiveFlowRuns` called.
  - Legacy CBC token triggers the `whatsAppConfig.update` GCM upgrade.
  - Reply-to context id propagation, template-row mapping to snake_case, phone auto-correct persist, `db_error`/500 mapping, `SendMessageError` code/status.
- `npx vitest run --reporter=dot` (full) → **90 files / 830 tests passed**.
- `npx tsc --noEmit` → **EXIT 0**.

## Files changed

- `src/lib/whatsapp/send-message.ts` — migrated to Prisma (modified).
- `src/lib/whatsapp/template-row-mapper.ts` — new `prismaTemplateToMessage` mapper.
- `src/lib/whatsapp/send-message.test.ts` — rewritten to mock prisma (modified).
- `src/app/api/whatsapp/send/route.test.ts` — updated to mock prisma (modified, see below).

## Self-review findings

- Completeness: every row of the brief's swap table implemented exactly; all 7 steps done.
- Quality: follows the contacts-migration pattern (`_db: unknown`, prisma singleton, accountId-scoped queries). Stale module doc comments about `SupabaseClient` updated to reflect the Prisma reality.
- Discipline: only required changes. No YAGNI.

## Issues / concerns

1. **`route.test.ts` was modified even though the brief only listed `send-message.ts` + `send-message.test.ts`.** This was *forced*: the brief's verify step requires the full suite green, and the route test exercised the send core through the old Supabase mock. After migration the core reads prisma, so that test 500'd. I updated only its mocks/assertions (added a prisma mock; message persistence assertions moved from `messageInserts` to `prisma.message.create`). The route **source** (`route.ts`) was NOT migrated — it still uses Supabase for its own find-or-create, per instructions. If the orchestrator prefers this handled differently, it's isolated to that one test file.
2. **`interactivePayload` Json semantics:** on MySQL, Prisma stores SQL NULL via `Prisma.DbNull` (plain `null` is not accepted by the input type). The migrated row stores `Prisma.DbNull` for non-interactive messages — behaviourally identical to the old `null` insert, but worth knowing for any future reads/serializers.
3. The migrated test's success-path assertion includes `interactivePayload: Prisma.DbNull`, coupling the test to the Prisma sentinel (intentional, precise).

## Commit

- `742b8b7` — `refactor(whatsapp): migrate outbound send core to Prisma` (4 files: +593/−138, includes new `template-row-mapper.ts`)
