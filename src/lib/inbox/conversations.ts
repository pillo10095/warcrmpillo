import type { Prisma } from '@prisma/client';
import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

/** Prisma include that embeds the contact + its tags — the MySQL
 *  replacement for the Supabase {@link CONVERSATION_SELECT} string. */
export const CONVERSATION_INCLUDE = {
  contact: { include: { contactTags: { include: { tag: true } } } },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;

/** Map a Prisma conversation row (camelCase, nested contactTags) into
 *  the snake_case wire `Conversation` shape — same output the Supabase
 *  {@link normalizeConversation} produced, so v1 serializers see no
 *  change. */
export function prismaToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    user_id: row.userId,
    contact_id: row.contactId,
    status: row.status,
    assigned_agent_id: row.assignedAgentId ?? undefined,
    last_message_text: row.lastMessageText ?? undefined,
    last_message_at: row.lastMessageAt?.toISOString() ?? undefined,
    unread_count: row.unreadCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    contact: row.contact
      ? {
          id: row.contact.id,
          user_id: row.contact.userId,
          account_id: row.contact.accountId,
          phone: row.contact.phone,
          phone_normalized: row.contact.phoneNormalized ?? undefined,
          name: row.contact.name ?? undefined,
          email: row.contact.email ?? undefined,
          company: row.contact.company ?? undefined,
          avatar_url: row.contact.avatarUrl ?? undefined,
          created_at: row.contact.createdAt.toISOString(),
          updated_at: row.contact.updatedAt.toISOString(),
          tags: (row.contact.contactTags ?? [])
            .map((ct) => ct.tag)
            .filter((t): t is Prisma.TagGetPayload<Record<string, never>> =>
              t != null,
            )
            .map((t) => ({
              id: t.id,
              user_id: t.userId,
              name: t.name,
              color: t.color,
              created_at: t.createdAt.toISOString(),
            })),
        }
      : undefined,
  };
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
