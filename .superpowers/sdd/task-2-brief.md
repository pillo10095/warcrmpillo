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

