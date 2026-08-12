import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type NextRequest } from 'next/server';

// Shared mock state, hoisted so the module mocks can close over it.
const mockDb = vi.hoisted(() => ({
  memberPresence: { upsert: vi.fn() },
  webhookEndpoint: { update: vi.fn() },
  automation: { update: vi.fn() },
  flow: { update: vi.fn() },
  contact: { findMany: vi.fn(), count: vi.fn() },
  aiKnowledgeChunk: { findMany: vi.fn() },
  conversation: { updateMany: vi.fn() },
  broadcast: { create: vi.fn() },
  broadcastRecipient: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: mockDb }));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: vi.fn() }));
vi.mock('@/lib/auth/cookies', () => ({ SESSION_COOKIE: 'wacrm_session' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'token-1' }) }),
}));

import { getSessionUser } from '@/lib/auth/session';
import { POST } from './route';

const user = { userId: 'user-1', accountId: 'acc-1' };

function rpcRequest(body: unknown) {
  return new Request('http://localhost/api/data/rpc/test', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function callRpc(fn: string, body: unknown) {
  return POST(rpcRequest(body), { params: Promise.resolve({ function: fn }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue(user as never);
  // Transaction client is the same mock object.
  mockDb.$transaction.mockImplementation((cb: unknown) =>
    (cb as (tx: unknown) => Promise<unknown>)(mockDb),
  );
});

describe('RPC route: auth and routing', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const res = await callRpc('touch_presence', { p_status: 'online' });
    expect(res.status).toBe(401);
  });

  it('returns 404 with error shape for an unknown function', async () => {
    const res = await callRpc('definitely_not_real', {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('404');
    expect(body.error.message).toContain('Unknown function');
  });

  it('returns 500 with the handler error message on failure', async () => {
    mockDb.memberPresence.upsert.mockRejectedValue(new Error('boom'));
    const res = await callRpc('touch_presence', { p_status: 'online' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toBe('boom');
    expect(body.error.code).toBe('500');
  });
});

describe('touch_presence', () => {
  it('reads the p_status param and upserts presence', async () => {
    const res = await callRpc('touch_presence', { p_status: 'away' });
    expect(res.status).toBe(200);
    expect(mockDb.memberPresence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        update: expect.objectContaining({ status: 'away' }),
        create: expect.objectContaining({ userId: 'user-1', accountId: 'acc-1', status: 'away' }),
      }),
    );
  });

  it('defaults to online when p_status is absent', async () => {
    await callRpc('touch_presence', {});
    expect(mockDb.memberPresence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'online' }),
      }),
    );
  });
});

describe('record_webhook_failure', () => {
  it('increments failure_count for the given endpoint_id', async () => {
    await callRpc('record_webhook_failure', { endpoint_id: 'ep-1' });
    expect(mockDb.webhookEndpoint.update).toHaveBeenCalledWith({
      where: { id: 'ep-1' },
      data: { failureCount: { increment: 1 } },
    });
  });
});

describe('increment_automation_execution_count / increment_flow_execution_count', () => {
  it('reads p_automation_id and bumps execution + lastExecutedAt', async () => {
    await callRpc('increment_automation_execution_count', { p_automation_id: 'auto-1' });
    expect(mockDb.automation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'auto-1' },
        data: expect.objectContaining({ executionCount: { increment: 1 } }),
      }),
    );
  });

  it('reads p_flow_id and bumps execution + lastExecutedAt', async () => {
    await callRpc('increment_flow_execution_count', { p_flow_id: 'flow-1' });
    expect(mockDb.flow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'flow-1' },
        data: expect.objectContaining({ executionCount: { increment: 1 } }),
      }),
    );
  });
});

describe('filter_contacts_by_tags', () => {
  it('returns [] when p_tag_ids is empty or missing', async () => {
    const res = await callRpc('filter_contacts_by_tags', {});
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
    expect(mockDb.contact.findMany).not.toHaveBeenCalled();
  });

  it('filters by account, tags, and optional search, scoped to account', async () => {
    mockDb.contact.findMany.mockResolvedValue([
      { id: 'c-1', createdAt: new Date() },
    ]);
    mockDb.contact.count.mockResolvedValue(17);

    const res = await callRpc('filter_contacts_by_tags', {
      p_tag_ids: ['tag-1', 'tag-2'],
      p_search: '  Ada  ',
      p_limit: 10,
      p_offset: 5,
    });

    expect(mockDb.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: 'acc-1',
          contactTags: { some: { tagId: { in: ['tag-1', 'tag-2'] } } },
          OR: [
            { name: { contains: 'Ada' } },
            { phone: { contains: 'Ada' } },
            { email: { contains: 'Ada' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        skip: 5,
        take: 10,
      }),
    );
    expect(mockDb.contact.count).toHaveBeenCalledTimes(1);

    // PostgREST contract of migration 025: rows carry contact + total_count.
    const body = await res.json();
    expect(body.data).toEqual([
      { contact: { id: 'c-1', createdAt: expect.any(String) }, total_count: 17 },
    ]);
  });

  it('does not add a search clause when p_search is absent', async () => {
    mockDb.contact.findMany.mockResolvedValue([]);
    mockDb.contact.count.mockResolvedValue(0);

    await callRpc('filter_contacts_by_tags', { p_tag_ids: ['tag-1'] });

    const arg = mockDb.contact.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).not.toHaveProperty('OR');
  });
});

describe('match_ai_knowledge_fts', () => {
  it('returns [] when p_query is empty', async () => {
    const res = await callRpc('match_ai_knowledge_fts', { p_query: '', p_match_count: 5 });
    expect((await res.json()).data).toEqual([]);
    expect(mockDb.aiKnowledgeChunk.findMany).not.toHaveBeenCalled();
  });

  it('searches content with LIKE, account-scoped and limited', async () => {
    mockDb.aiKnowledgeChunk.findMany.mockResolvedValue([
      { id: 'k-1', documentId: 'doc-1', content: 'how to reset the password' },
    ]);

    const res = await callRpc('match_ai_knowledge_fts', { p_query: 'password', p_match_count: 3 });
    expect(mockDb.aiKnowledgeChunk.findMany).toHaveBeenCalledWith({
      where: { accountId: 'acc-1', content: { contains: 'password' } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, documentId: true, content: true },
    });
    expect((await res.json()).data).toHaveLength(1);
  });
});

describe('match_ai_knowledge_semantic', () => {
  it('always returns [] (pgvector unsupported on MySQL)', async () => {
    const res = await callRpc('match_ai_knowledge_semantic', {
      p_query_embedding: '[1,2,3]',
      p_match_count: 5,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });
});

describe('claim_ai_reply_slot', () => {
  it('returns true when an atomic increment succeeds', async () => {
    mockDb.conversation.updateMany.mockResolvedValue({ count: 1 });
    const res = await callRpc('claim_ai_reply_slot', {
      conversation_id: 'conv-1',
      max_replies: 3,
    });
    expect(mockDb.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-1', aiReplyCount: { lt: 3 } },
      data: { aiReplyCount: { increment: 1 } },
    });
    expect((await res.json()).data).toBe(true);
  });

  it('returns false when no slot is available', async () => {
    mockDb.conversation.updateMany.mockResolvedValue({ count: 0 });
    const res = await callRpc('claim_ai_reply_slot', {
      conversation_id: 'conv-1',
      max_replies: 1,
    });
    expect((await res.json()).data).toBe(false);
  });

  it('returns false without hitting the db when params are invalid', async () => {
    mockDb.conversation.updateMany.mockResolvedValue({ count: 1 });
    const noId = await callRpc('claim_ai_reply_slot', { conversation_id: '' });
    expect((await noId.json()).data).toBe(false);
    const noCap = await callRpc('claim_ai_reply_slot', {
      conversation_id: 'conv-1',
      max_replies: 0,
    });
    expect((await noCap.json()).data).toBe(false);
    expect(mockDb.conversation.updateMany).not.toHaveBeenCalled();
  });
});

describe('create_broadcast_with_recipients', () => {
  it('creates a broadcast and all recipients in one transaction', async () => {
    mockDb.broadcast.create.mockResolvedValue({ id: 'b-1' });
    mockDb.broadcastRecipient.create.mockImplementation(
      (args: { data: { broadcastId: string; contactId: string } }) =>
        Promise.resolve({
          id: `r-${args.data.contactId}`,
          ...args.data,
        }),
    );

    const res = await callRpc('create_broadcast_with_recipients', {
      p_account_id: 'acc-1',
      p_user_id: 'user-1',
      p_name: 'May promo',
      p_template_name: 'promo_template',
      p_template_language: 'es_AR',
      p_total_recipients: 2,
      p_contact_ids: ['c-1', 'c-2'],
    });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.broadcast.create).toHaveBeenCalledWith({
      data: {
        accountId: 'acc-1',
        userId: 'user-1',
        name: 'May promo',
        templateName: 'promo_template',
        templateLanguage: 'es_AR',
        totalRecipients: 2,
        status: 'sending',
      },
    });
    expect(mockDb.broadcastRecipient.create).toHaveBeenCalledTimes(2);

    const body = await res.json();
    expect(body.data).toEqual([
      { broadcast_id: 'b-1', recipient_id: 'r-c-1', contact_id: 'c-1' },
      { broadcast_id: 'b-1', recipient_id: 'r-c-2', contact_id: 'c-2' },
    ]);
  });

  it('returns [] without touching the db when required params are missing', async () => {
    const res = await callRpc('create_broadcast_with_recipients', {
      p_account_id: 'acc-1',
      p_user_id: 'user-1',
      p_name: 'Untitled',
      p_template_name: 'tpl',
      p_contact_ids: [],
    });
    expect((await res.json()).data).toEqual([]);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});