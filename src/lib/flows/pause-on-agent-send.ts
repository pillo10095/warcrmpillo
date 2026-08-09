import { supabaseAdmin } from './admin-client'

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
      .eq('status', 'active')
    if (error) {
      console.error('[flows] pause-on-agent-send failed:', error.message)
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    )
  }
}
