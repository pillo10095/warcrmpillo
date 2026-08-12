# Task 6 Report: Migrate POST /api/v1/messages to Prisma

## What I implemented

**`src/app/api/v1/messages/route.ts` (modified)** — exactly as the brief specified:

- Changed both shared-lib call sites from `ctx.supabase` to `undefined`:
  - `resolveConversationByPhone(undefined, ctx.accountId, to, name)` (route.ts:101)
  - `sendMessageToConversation(undefined, ctx.accountId, { ... })` (route.ts:108)
- Updated the header comment: removed the "service-role client" reference, replaced with "every query is explicitly scoped by `ctx.accountId` (application-level RLS)" — matching the conversations route header style.
- `requireApiKey(request, 'messages:send')` kept. No other logic changes: validation order, template unpacking, interactive payload cast, error mapping all untouched.

**`src/app/api/v1/messages/route.test.ts` (new)** — 6 tests:

1. **Missing/invalid API key → 401 envelope** — `requireApiKey` rejects with `unauthorized()`; asserts 401 + `error.code === 'unauthorized'` and that neither resolve nor send was called.
2. **Non-object body → 400** — raw non-JSON body; asserts 400 + `bad_request`, no downstream calls.
3. **Missing `to` → 400** — asserts 400 + `bad_request`, no downstream calls.
4. **Unsupported type → 400 before any resolve** — `{ to, type: 'bogus' }`; asserts 400 and that `resolveConversationByPhone` / `sendMessageToConversation` were NOT called (validation runs before find-or-create, so no orphan contact/conversation).
5. **Valid text send → 201 envelope** — asserts full data envelope `{ message_id, whatsapp_message_id, conversation_id, contact_id, contact_created }`, and that both libs were called with `undefined` as the leading `db` arg plus the correct accountId / payload.
6. **`SendMessageError` → mapped envelope** — send core rejects with `new SendMessageError('meta_error', 'Meta API error: boom', 502)`; asserts 502 + `error.code === 'meta_error'` (verifies the real `instanceof SendMessageError` mapping path).

**Mock strategy:** `requireApiKey` and `resolveConversationByPhone` are fully mocked. `@/lib/whatsapp/send-message` is *partially* mocked via `vi.mock` + `importOriginal` spread — only `sendMessageToConversation` is stubbed; `validateSendMessageParams` and `SendMessageError` stay REAL so the route's validation and error-mapping logic are genuinely exercised (not scripted). This matches the brief's primary suggestion ("Mock … send-message (or mock prisma end-to-end)") and keeps the route test focused — the send/resolve cores already have their own comprehensive unit tests (`send-message.test.ts`, `resolve-conversation.test.ts`).

## What I tested and results

- Focused: `npx vitest run src/app/api/v1/messages --reporter=dot` → **6/6 pass**
- Full suite: `npx vitest run --reporter=dot` → **94 files, 854 tests, all pass**
- Typecheck: `npx tsc --noEmit` → **EXIT 0**

## Files changed

- `src/app/api/v1/messages/route.ts` (modified)
- `src/app/api/v1/messages/route.test.ts` (created)

## Commit

- `620e4cb` — `feat(v1): migrate messages send route to Prisma`

## Self-review findings

- **Completeness:** all four brief coverage points covered, plus the "invalid payload" (non-object body) case from the Job section. Behavior is actually asserted (status codes, envelope fields, negative-call assertions), not just smoke-tested.
- **Quality:** mock keeps real validation + `SendMessageError` so the route's own logic is what's being verified; the valid-send test pins the `undefined` leading-arg (the whole point of the migration).
- **Discipline:** only the two files in the brief touched. `.superpowers/` and `docs/superpowers/plans/2026-08-09-wacrm-inbox-module.md` remain untracked (out of task scope). No restructure, no extra behavior.

## Issues / concerns

None blocking. Notes:

- `ctx.supabase` still exists on `ApiKeyContext` (typed, always null at runtime) — it's deleted when the last CRM v1 consumer (broadcasts) migrates, which is a separate task.
- Prettier lint (`npm run lint`) was not run; the new test follows the exact formatting conventions of the sibling route tests and `tsc` is clean. Happy to run lint if the orchestrator wants it.
