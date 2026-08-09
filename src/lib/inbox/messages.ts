import type { Prisma } from '@prisma/client';
import type { Message } from '@/types';

type MessageRow = Prisma.MessageGetPayload<Record<string, never>>;

/** Map a Prisma message row (camelCase) into the snake_case wire
 *  `Message` shape consumed by the v1 serializer. */
export function prismaToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    sender_type: row.senderType,
    sender_id: row.senderId ?? undefined,
    content_type: row.contentType,
    content_text: row.contentText ?? undefined,
    media_url: row.mediaUrl ?? undefined,
    template_name: row.templateName ?? undefined,
    message_id: row.messageId ?? undefined,
    status: row.status,
    reply_to_message_id: row.replyToMessageId ?? undefined,
    interactive_reply_id: row.interactiveReplyId ?? undefined,
    interactive_payload:
      (row.interactivePayload as unknown as Message['interactive_payload']) ??
      undefined,
    ai_generated: row.aiGenerated,
    created_at: row.createdAt.toISOString(),
  };
}
