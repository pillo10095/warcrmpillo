import { describe, it, expect } from "vitest";
import {
  matchesContactFilters,
  normalizeConversation,
  prismaToConversation,
} from "./conversations";
import type { Conversation } from "@/types";

const ISO = "2025-01-01T00:00:00.000Z";

type ConversationRow = Parameters<typeof prismaToConversation>[0];

interface ContactFixture {
  id: string;
  accountId: string;
  userId: string;
  phone: string;
  phoneNormalized: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  contactTags: {
    id: string;
    contactId: string;
    tagId: string;
    createdAt: Date;
    tag: {
      id: string;
      accountId: string;
      userId: string;
      name: string;
      color: string;
      createdAt: Date;
    };
  }[];
}

/** Full Prisma `Conversation` row shape (CONVERSATION_INCLUDE payload).
 *  Cast because the Prisma payload types a required-relation include as
 *  non-nullable, while the mapper itself handles `contact: null`. */
function makePrismaRow(contact: ContactFixture | null): ConversationRow {
  return {
    id: "c1",
    accountId: "a1",
    userId: "u1",
    contactId: "ct1",
    status: "open",
    assignedAgentId: null,
    lastMessageText: null,
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: new Date(ISO),
    updatedAt: new Date(ISO),
    contact,
  } as unknown as ConversationRow;
}

function makeContact(overrides: Partial<ContactFixture> = {}): ContactFixture {
  return {
    id: "ct1",
    accountId: "a1",
    userId: "u1",
    phone: "+15551234567",
    phoneNormalized: null,
    name: "Ada",
    email: null,
    company: "Acme",
    avatarUrl: null,
    createdAt: new Date(ISO),
    updatedAt: new Date(ISO),
    contactTags: [],
    ...overrides,
  };
}

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});

describe("prismaToConversation", () => {
  it("maps camelCase columns to the snake_case wire shape", () => {
    const row = makePrismaRow(
      makeContact({
        contactTags: [
          {
            id: "j1",
            contactId: "ct1",
            tagId: "t1",
            createdAt: new Date(ISO),
            tag: {
              id: "t1",
              accountId: "a1",
              userId: "u1",
              name: "VIP",
              color: "#fbbf24",
              createdAt: new Date(ISO),
            },
          },
        ],
      }),
    );
    row.assignedAgentId = "agent-1";
    row.lastMessageText = "Hello";
    row.lastMessageAt = new Date("2025-01-02T00:00:00.000Z");
    row.unreadCount = 3;

    const mapped = prismaToConversation(row);

    expect(mapped.id).toBe("c1");
    expect(mapped.user_id).toBe("u1");
    expect(mapped.contact_id).toBe("ct1");
    expect(mapped.status).toBe("open");
    expect(mapped.assigned_agent_id).toBe("agent-1");
    expect(mapped.last_message_text).toBe("Hello");
    expect(mapped.last_message_at).toBe("2025-01-02T00:00:00.000Z");
    expect(mapped.unread_count).toBe(3);
    expect(mapped.created_at).toBe(ISO);
    expect(mapped.updated_at).toBe(ISO);
  });

  it("flattens contactTags[].tag into contact.tags", () => {
    const row = makePrismaRow(
      makeContact({
        contactTags: [
          {
            id: "j1",
            contactId: "ct1",
            tagId: "t1",
            createdAt: new Date(ISO),
            tag: {
              id: "t1",
              accountId: "a1",
              userId: "u1",
              name: "VIP",
              color: "#fbbf24",
              createdAt: new Date(ISO),
            },
          },
          {
            id: "j2",
            contactId: "ct1",
            tagId: "t2",
            createdAt: new Date(ISO),
            tag: {
              id: "t2",
              accountId: "a1",
              userId: "u1",
              name: "Lead",
              color: "#3b82f6",
              createdAt: new Date(ISO),
            },
          },
        ],
      }),
    );

    const mapped = prismaToConversation(row);

    expect(mapped.contact?.tags).toEqual([
      {
        id: "t1",
        user_id: "u1",
        name: "VIP",
        color: "#fbbf24",
        created_at: ISO,
      },
      {
        id: "t2",
        user_id: "u1",
        name: "Lead",
        color: "#3b82f6",
        created_at: ISO,
      },
    ]);
  });

  it("maps the embedded contact and drops the join wrapper", () => {
    const mapped = prismaToConversation(makePrismaRow(makeContact()));

    expect(mapped.contact).toEqual({
      id: "ct1",
      user_id: "u1",
      account_id: "a1",
      phone: "+15551234567",
      phone_normalized: undefined,
      name: "Ada",
      email: undefined,
      company: "Acme",
      avatar_url: undefined,
      created_at: ISO,
      updated_at: ISO,
      tags: [],
    });
  });

  it("handles a null contact", () => {
    const mapped = prismaToConversation(makePrismaRow(null));

    expect(mapped.contact).toBeUndefined();
  });
});
