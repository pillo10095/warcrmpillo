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
