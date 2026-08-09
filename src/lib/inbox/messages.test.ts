import { describe, it, expect } from 'vitest';
import { prismaToMessage } from './messages';

const ISO = '2025-01-01T00:00:00.000Z';

type MessageRow = Parameters<typeof prismaToMessage>[0];

function makePrismaMessageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    conversationId: 'c1',
    senderType: 'customer',
    senderId: 'ct1',
    contentType: 'text',
    contentText: 'Hello',
    mediaUrl: null,
    templateName: null,
    messageId: 'wamid-1',
    status: 'sent',
    replyToMessageId: null,
    interactiveReplyId: null,
    interactivePayload: null,
    aiGenerated: false,
    createdAt: new Date(ISO),
    ...overrides,
  } as MessageRow;
}

describe('prismaToMessage', () => {
  it('maps camelCase columns to the snake_case wire shape', () => {
    const mapped = prismaToMessage(
      makePrismaMessageRow({
        senderType: 'agent',
        contentType: 'image',
        mediaUrl: 'https://example.com/a.png',
        templateName: 'welcome',
        messageId: 'wamid-9',
        status: 'read',
        replyToMessageId: 'm0',
        interactiveReplyId: 'row-1',
        aiGenerated: true,
      })
    );

    expect(mapped).toMatchObject({
      id: 'm1',
      conversation_id: 'c1',
      sender_type: 'agent',
      sender_id: 'ct1',
      content_type: 'image',
      content_text: 'Hello',
      media_url: 'https://example.com/a.png',
      template_name: 'welcome',
      message_id: 'wamid-9',
      status: 'read',
      reply_to_message_id: 'm0',
      interactive_reply_id: 'row-1',
      ai_generated: true,
      created_at: ISO,
    });
  });

  it('maps messageId to message_id', () => {
    const mapped = prismaToMessage(makePrismaMessageRow());

    expect(mapped.message_id).toBe('wamid-1');
    expect(mapped).not.toHaveProperty('messageId');
  });

  it('maps a persisted interactive payload onto interactive_payload', () => {
    const payload = {
      kind: 'buttons',
      body: 'Pick one',
      buttons: [{ id: 'b1', title: 'Yes' }],
    };
    const mapped = prismaToMessage(
      makePrismaMessageRow({
        contentType: 'interactive',
        interactivePayload: payload,
      })
    );

    expect(mapped.interactive_payload).toEqual(payload);
  });

  it('turns null optionals into undefined', () => {
    const mapped = prismaToMessage(
      makePrismaMessageRow({
        senderId: null,
        contentText: null,
        mediaUrl: null,
        templateName: null,
        messageId: null,
        replyToMessageId: null,
        interactiveReplyId: null,
        interactivePayload: null,
      })
    );

    expect(mapped.sender_id).toBeUndefined();
    expect(mapped.content_text).toBeUndefined();
    expect(mapped.media_url).toBeUndefined();
    expect(mapped.template_name).toBeUndefined();
    expect(mapped.message_id).toBeUndefined();
    expect(mapped.reply_to_message_id).toBeUndefined();
    expect(mapped.interactive_reply_id).toBeUndefined();
    expect(mapped.interactive_payload).toBeUndefined();
  });
});
