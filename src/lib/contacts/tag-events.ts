import type { AutomationContext } from '@/lib/automations/engine';

import { addContactTagIfAbsent } from './tag-write';
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

export { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

interface AddContactTagAndDispatchInput {
  db: unknown;
  accountId: string;
  contactId: string;
  tagId: string;
  context?: AutomationContext;
}

export interface AddContactTagResult {
  added: boolean;
  dispatched: boolean;
  reason?: 'duplicate' | 'max_depth';
}

/**
 * Central server-side tag writer. It used to dispatch tag_added only
 * for a newly-created join and capped chained tag automations to avoid
 * loops.
 *
 * Task B decouples the automations dispatch: the engine
 * (`src/lib/automations/engine.ts`, supabaseAdmin-based) is migrated in
 * Task E. Until then the write happens but the dispatch is a no-op that
 * logs a warning so we never call the engine through a stale client.
 */
export async function addContactTagAndDispatch(
  input: AddContactTagAndDispatchInput
): Promise<AddContactTagResult> {
  const added = await addContactTagIfAbsent(input.db, {
    accountId: input.accountId,
    contactId: input.contactId,
    tagId: input.tagId,
  });

  if (!added) return { added: false, dispatched: false, reason: 'duplicate' };

  const depth = getTagChainDepth(input.context);
  if (depth >= MAX_TAG_CHAIN_DEPTH) {
    console.warn('[automations] tag_added chain depth limit reached', {
      accountId: input.accountId,
      contactId: input.contactId,
      tagId: input.tagId,
      depth,
    });
    return { added: true, dispatched: false, reason: 'max_depth' };
  }

  // TODO(Task E): dispatch tag_added to the Prisma-backed automations
  // engine (runAutomationsForTrigger with the incremented chain depth).
  // The engine is 869 lines of pure supabaseAdmin and is out of scope
  // for the contacts slice migration.
  console.warn(
    '[automations] tag_added dispatch deferred until automations engine migration'
  );
  return { added: true, dispatched: false };
}
