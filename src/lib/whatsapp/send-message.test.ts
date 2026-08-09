import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: { findFirst: vi.fn(), update: vi.fn() },
    whatsAppConfig: { findUnique: vi.fn(), update: vi.fn() },
    message: { findFirst: vi.fn(), create: vi.fn() },
    messageTemplate: { findFirst: vi.fn() },
    contact: { update: vi.fn() },
  },
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
  pauseActiveFlowRuns: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: mocks.sendTextMessage,
  sendTemplateMessage: mocks.sendTemplateMessage,
  sendMediaMessage: mocks.sendMediaMessage,
  sendInteractiveButtons: mocks.sendInteractiveButtons,
  sendInteractiveList: mocks.sendInteractiveList,
  INTERACTIVE_LIMITS: {
    maxButtons: 3,
    buttonTitleMaxLength: 20,
    maxListSections: 10,
    maxListRowsTotal: 10,
    listRowTitleMaxLength: 24,
    listRowDescriptionMaxLength: 72,
    bodyMaxLength: 1024,
    footerMaxLength: 60,
    headerTextMaxLength: 60,
  },
}));
vi.mock('@/lib/flows/pause-on-agent-send', () => ({
  pauseActiveFlowRuns: mocks.pauseActiveFlowRuns,
}));

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';
import { encrypt } from './encryption';
import { Prisma } from '@prisma/client';

const ACCOUNT_ID = 'acct-1';

// Non-legacy (GCM) token so the self-heal upgrade path stays idle by default.
const GCM_TOKEN = encrypt('meta-access-token');

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cv-1',
    accountId: ACCOUNT_ID,
    userId: 'user-1',
    contactId: 'contact-1',
    status: 'open',
    assignedAgentId: null,
    lastMessageText: null,
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    contact: {
      id: 'contact-1',
      userId: 'user-1',
      accountId: ACCOUNT_ID,
      phone: '+14155550123',
      phoneNormalized: null,
      name: 'Jane',
      email: null,
      company: null,
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    ...overrides,
  };
}

function configRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    accountId: ACCOUNT_ID,
    userId: 'user-1',
    phoneNumberId: '1234567890',
    wabaId: null,
    accessToken: GCM_TOKEN,
    verifyToken: null,
    status: 'connected',
    connectedAt: null,
    registeredAt: null,
    subscribedAppsAt: null,
    lastRegistrationError: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.prisma.conversation.findFirst.mockResolvedValue(conversationRow());
  mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue(configRow());
  mocks.prisma.whatsAppConfig.update.mockResolvedValue({});
  mocks.prisma.message.findFirst.mockResolvedValue(null);
  mocks.prisma.message.create.mockResolvedValue({ id: 'msg-1' });
  mocks.prisma.messageTemplate.findFirst.mockResolvedValue(null);
  mocks.prisma.contact.update.mockResolvedValue({});
  mocks.sendTextMessage.mockResolvedValue({ messageId: 'wamid-1' });
  mocks.sendTemplateMessage.mockResolvedValue({ messageId: 'wamid-1' });
  mocks.sendMediaMessage.mockResolvedValue({ messageId: 'wamid-1' });
  mocks.sendInteractiveButtons.mockResolvedValue({ messageId: 'wamid-1' });
  mocks.sendInteractiveList.mockResolvedValue({ messageId: 'wamid-1' });
  mocks.pauseActiveFlowRuns.mockResolvedValue(undefined);
});

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(undefined, ACCOUNT_ID, params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(undefined, ACCOUNT_ID, params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('rejects invalid params WITHOUT querying prisma', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
    expect(mocks.prisma.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });
});

describe('sendMessageToConversation — conversation + contact load', () => {
  it('audio with a long caption passes validation and reaches the conversation lookup', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(
      sendMessageToConversation(undefined, ACCOUNT_ID, {
        conversationId: 'cv-1',
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(mocks.prisma.conversation.findFirst).toHaveBeenCalled();
  });

  it('404 when the conversation is not in the account', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(
      sendMessageToConversation(undefined, ACCOUNT_ID, {
        conversationId: 'nope',
        messageType: 'text',
        contentText: 'hi',
      })
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('400 when the contact has no phone', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(
      conversationRow({ contact: { ...conversationRow().contact, phone: '' } })
    );
    await expect(
      sendMessageToConversation(undefined, ACCOUNT_ID, {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'hi',
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('400 when the contact phone is not a valid E.164 number', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(
      conversationRow({ contact: { ...conversationRow().contact, phone: 'abc' } })
    );
    await expect(
      sendMessageToConversation(undefined, ACCOUNT_ID, {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'hi',
      })
    ).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
      message: 'Invalid phone number format',
    });
  });
});

describe('sendMessageToConversation — config', () => {
  it('whatsapp_not_configured when no config row exists', async () => {
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue(null);
    await expect(
      sendMessageToConversation(undefined, ACCOUNT_ID, {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'hi',
      })
    ).rejects.toMatchObject({ code: 'whatsapp_not_configured', status: 400 });
  });

  it('re-encrypts a legacy CBC token via whatsAppConfig.update (fire-and-forget)', async () => {
    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'),
      iv
    );
    let enc = cipher.update('meta-access-token', 'utf8', 'hex');
    enc += cipher.final('hex');
    const legacyToken = `${iv.toString('hex')}:${enc}`;
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue(
      configRow({ accessToken: legacyToken })
    );

    await sendMessageToConversation(undefined, ACCOUNT_ID, {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'hi',
    });

    expect(mocks.prisma.whatsAppConfig.update).toHaveBeenCalledWith({
      where: { id: 'cfg-1' },
      data: { accessToken: expect.any(String) },
    });
  });
});

describe('sendMessageToConversation — reply-to context', () => {
  it('400 when reply_to_message_id is not in the conversation', async () => {
    mocks.prisma.message.findFirst.mockResolvedValue(null);
    await expect(
      sendMessageToConversation(undefined, ACCOUNT_ID, {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'hi',
        replyToMessageId: 'msg-x',
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('passes the parent Meta message_id as the send context', async () => {
    mocks.prisma.message.findFirst.mockResolvedValue({
      messageId: 'wamid-parent',
    });
    await sendMessageToConversation(undefined, ACCOUNT_ID, {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'hi',
      replyToMessageId: 'msg-parent',
    });
    expect(mocks.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contextMessageId: 'wamid-parent' })
    );
  });
});

describe('sendMessageToConversation — template sends', () => {
  it('maps the Prisma template row to the snake_case shape and sends with it', async () => {
    mocks.prisma.messageTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      accountId: ACCOUNT_ID,
      userId: 'user-1',
      name: 'welcome',
      category: 'Marketing',
      language: 'en_US',
      headerType: null,
      headerContent: null,
      bodyText: 'Welcome {{1}}',
      footerText: null,
      buttons: null,
      sampleValues: null,
      metaTemplateId: 'meta-tpl-1',
      rejectionReason: null,
      qualityScore: null,
      headerHandle: null,
      headerMediaUrl: null,
      submissionError: null,
      lastSubmittedAt: null,
      status: 'APPROVED',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await sendMessageToConversation(undefined, ACCOUNT_ID, {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'welcome',
      templateLanguage: 'en_US',
    });

    expect(mocks.prisma.messageTemplate.findFirst).toHaveBeenCalledWith({
      where: { accountId: ACCOUNT_ID, name: 'welcome', language: 'en_US' },
    });
    expect(mocks.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        template: expect.objectContaining({
          id: 'tpl-1',
          user_id: 'user-1',
          name: 'welcome',
          category: 'Marketing',
          body_text: 'Welcome {{1}}',
        }),
      })
    );
  });

  it('defaults the template language to en_US when not provided', async () => {
    await sendMessageToConversation(undefined, ACCOUNT_ID, {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'welcome',
    });
    expect(mocks.prisma.messageTemplate.findFirst).toHaveBeenCalledWith({
      where: { accountId: ACCOUNT_ID, name: 'welcome', language: 'en_US' },
    });
  });
});

describe('sendMessageToConversation — success path', () => {
  it('sends via Meta, persists the message, updates the conversation and pauses flows', async () => {
    const result = await sendMessageToConversation(undefined, ACCOUNT_ID, {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Hello there',
    });

    expect(result).toEqual({ messageId: 'msg-1', whatsappMessageId: 'wamid-1' });
    expect(mocks.sendTextMessage).toHaveBeenCalledWith({
      phoneNumberId: '1234567890',
      accessToken: 'meta-access-token',
      to: '14155550123',
      text: 'Hello there',
      contextMessageId: undefined,
    });
    expect(mocks.prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'cv-1',
        senderType: 'agent',
        contentType: 'text',
        contentText: 'Hello there',
        mediaUrl: null,
        templateName: null,
        interactivePayload: Prisma.DbNull,
        messageId: 'wamid-1',
        status: 'sent',
        replyToMessageId: null,
      },
    });
    expect(mocks.prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'cv-1' },
      data: {
        lastMessageText: 'Hello there',
        lastMessageAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    });
    expect(mocks.pauseActiveFlowRuns).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'contact-1'
    );
  });

  it('auto-corrects the contact phone and persists the working variant', async () => {
    mocks.sendTextMessage
      .mockRejectedValueOnce(new Error('#131030 not in allowed list'))
      .mockResolvedValueOnce({ messageId: 'wamid-2' });

    await sendMessageToConversation(undefined, ACCOUNT_ID, {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'hi',
    });

    expect(mocks.sendTextMessage).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: { phone: '104155550123' },
    });
  });

  it('maps a message create failure to db_error/500', async () => {
    mocks.prisma.message.create.mockRejectedValue(
      new Error('connection lost')
    );
    await expect(
      sendMessageToConversation(undefined, ACCOUNT_ID, {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'hi',
      })
    ).rejects.toMatchObject({ code: 'db_error', status: 500 });
    expect(mocks.sendTextMessage).toHaveBeenCalled();
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});
