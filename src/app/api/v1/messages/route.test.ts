import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  resolveConversationByPhone: vi.fn(),
  sendMessageToConversation: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: mocks.resolveConversationByPhone,
}));
// Keep the real `validateSendMessageParams` (so the route's validation
// runs for real) and the real `SendMessageError` class (so the route's
// `instanceof` mapping works) — only the Meta-heavy send core is stubbed.
vi.mock('@/lib/whatsapp/send-message', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/send-message')>();
  return {
    ...actual,
    sendMessageToConversation: mocks.sendMessageToConversation,
  };
});

import { POST } from './route';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { unauthorized } from '@/lib/api/v1/respond';

const ctx = {
  accountId: 'acct-1',
  keyId: 'key-1',
  scopes: ['messages:send'],
  createdBy: null,
};

const RESOLVED = {
  conversationId: 'cv-1',
  contactId: 'ct-1',
  contactCreated: true,
};

const SENT = { messageId: 'msg-1', whatsappMessageId: 'wamid-1' };

function postRequest(body: unknown) {
  return new Request('https://crm.example.com/api/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string) {
  return new Request('https://crm.example.com/api/v1/messages', {
    method: 'POST',
    body,
  });
}

beforeEach(() => {
  mocks.requireApiKey.mockReset().mockResolvedValue(ctx);
  mocks.resolveConversationByPhone.mockReset().mockResolvedValue(RESOLVED);
  mocks.sendMessageToConversation.mockReset().mockResolvedValue(SENT);
});

describe('POST /api/v1/messages', () => {
  it('rejects a missing or invalid API key with a 401 envelope', async () => {
    mocks.requireApiKey.mockRejectedValue(unauthorized());

    const response = await POST(postRequest({ to: '+14155550123', text: 'Hi' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('rejects a non-object body with a 400 envelope', async () => {
    const response = await POST(rawRequest('not-json'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('bad_request');
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it("rejects a missing 'to' with a 400 envelope", async () => {
    const response = await POST(postRequest({ type: 'text', text: 'Hi' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('bad_request');
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('rejects an unsupported type with a 400 before resolving anything', async () => {
    const response = await POST(
      postRequest({ to: '+14155550123', type: 'bogus', text: 'Hi' })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('bad_request');
    // Validation happens BEFORE find-or-create, so no contact/conversation
    // should have been touched by an invalid payload.
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('sends a valid text message and returns the 201 envelope', async () => {
    const response = await POST(
      postRequest({ to: '+14155550123', type: 'text', text: 'Hello!' })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual({
      message_id: 'msg-1',
      whatsapp_message_id: 'wamid-1',
      conversation_id: 'cv-1',
      contact_id: 'ct-1',
      contact_created: true,
    });
    // The Prisma-backed libs ignore their leading `db` arg — the route
    // must pass `undefined`, never a Supabase client.
    expect(mocks.resolveConversationByPhone).toHaveBeenCalledWith(
      undefined,
      'acct-1',
      '+14155550123',
      null
    );
    expect(mocks.sendMessageToConversation).toHaveBeenCalledWith(
      undefined,
      'acct-1',
      expect.objectContaining({
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'Hello!',
      })
    );
  });

  it('maps a SendMessageError from the send core to the envelope', async () => {
    mocks.sendMessageToConversation.mockRejectedValue(
      new SendMessageError('meta_error', 'Meta API error: boom', 502)
    );

    const response = await POST(
      postRequest({ to: '+14155550123', type: 'text', text: 'Hello!' })
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe('meta_error');
    expect(body.error.message).toBe('Meta API error: boom');
  });
});
