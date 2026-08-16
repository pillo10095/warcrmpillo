import { describe, it, expect } from "vitest";
import {
  parseInclude,
  parseSelect,
  parseFilters,
  camelToSnake,
  toWireShape,
  buildDataQuery,
} from "./query-builder";

describe("parseSelect", () => {
  it("returns undefined for *", () => {
    expect(parseSelect("conversations", "*")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(parseSelect("conversations", null)).toBeUndefined();
  });

  it("returns undefined for nested PostgREST syntax", () => {
    // Nested select maps to `include`, not `select` — the route applies both.
    expect(
      parseSelect("conversations", "*, contact:contacts(*)"),
    ).toBeUndefined();
  });

  it("parses plain column lists", () => {
    expect(parseSelect("conversations", "id,status")).toEqual({
      id: true,
      status: true,
    });
  });
});

describe("parseInclude", () => {
  it("returns undefined without nested syntax", () => {
    expect(parseInclude(null)).toBeUndefined();
    expect(parseInclude("*")).toBeUndefined();
    expect(parseInclude("id,status")).toBeUndefined();
  });

  it("parses the inbox CONVERSATION_SELECT into a Prisma include", () => {
    const include = parseInclude("*, contact:contacts(*, contact_tags(tags(*)))");
    expect(include).toEqual({
      contact: {
        include: {
          contactTags: {
            include: {
              tag: {},
            },
          },
        },
      },
    });
  });

  it("parses a simple aliased relation", () => {
    expect(parseInclude("*, contact:contacts(*)")).toEqual({
      contact: {},
    });
  });
});

describe("camelToSnake", () => {
  it("converts camelCase keys", () => {
    expect(camelToSnake("lastMessageText")).toBe("last_message_text");
    expect(camelToSnake("phoneNormalized")).toBe("phone_normalized");
    expect(camelToSnake("id")).toBe("id");
    expect(camelToSnake("aiAutoreplyDisabled")).toBe("ai_autoreply_disabled");
  });
});

describe("toWireShape", () => {
  it("converts a conversation row to the PostgREST wire shape", () => {
    const prismaRow = {
      id: "conv-1",
      userId: "u1",
      contactId: "c1",
      status: "open",
      lastMessageText: "hola",
      lastMessageAt: new Date("2026-08-13T03:00:00Z"),
      unreadCount: 2,
      createdAt: new Date("2026-08-13T01:00:00Z"),
      updatedAt: new Date("2026-08-13T03:00:00Z"),
      contact: {
        id: "c1",
        userId: "u1",
        accountId: "a1",
        phone: "5215512345678",
        phoneNormalized: "5215512345678",
        name: "Cliente Prueba",
        createdAt: new Date("2026-08-13T01:00:00Z"),
        updatedAt: new Date("2026-08-13T01:00:00Z"),
        contactTags: [
          { id: "ct1", tag: { id: "t1", userId: "u1", name: "vip", color: "#f00" } },
        ],
      },
    };

    const wire = toWireShape(prismaRow) as any;
    expect(wire.user_id).toBe("u1");
    expect(wire.contact_id).toBe("c1");
    expect(wire.last_message_text).toBe("hola");
    expect(wire.unread_count).toBe(2);
    expect(wire.last_message_at).toBe("2026-08-13T03:00:00.000Z");
    expect(wire.contact.phone_normalized).toBe("5215512345678");
    // Join rows carry `tags`, which normalizeConversation flattens.
    expect(wire.contact.contact_tags).toHaveLength(1);
    expect(wire.contact.contact_tags[0].tags.name).toBe("vip");
  });

  it("handles null and primitives", () => {
    expect(toWireShape(null)).toBeNull();
    expect(toWireShape("x")).toBe("x");
    expect(toWireShape([1, 2])).toEqual([1, 2]);
  });
});

describe("buildDataQuery", () => {
  it("carries include alongside select", () => {
    const q = buildDataQuery(
      "conversations",
      new URLSearchParams(
        "select=*, contact:contacts(*, contact_tags(tags(*)))&order=last_message_at.desc&limit=50",
      ),
    );
    expect(q.include).toBeDefined();
    expect(q.select).toBeUndefined();
    expect(q.orderBy).toEqual([{ lastMessageAt: "desc" }]);
    expect(q.take).toBe(50);
  });
});

describe("parseFilters (PostgREST wire format)", () => {
  it("parses the client's `col=eq.value` form", () => {
    const where = parseFilters(
      "conversations",
      new URLSearchParams(
        "id=eq.d4f93eef-d6d4-40e4-ae5c-31e952dd5939&account_id=eq.a1",
      ),
    );
    expect(where).toEqual({
      id: "d4f93eef-d6d4-40e4-ae5c-31e952dd5939",
      accountId: "a1",
    });
  });

  it("still parses the alternate `col.eq=value` form", () => {
    const where = parseFilters(
      "contacts",
      new URLSearchParams("phone.eq=5215512345678"),
    );
    expect(where).toEqual({ phone: "5215512345678" });
  });

  it("parses `in` values wrapped in parentheses", () => {
    const where = parseFilters(
      "conversations",
      new URLSearchParams("id=in.(a,b,c)"),
    );
    expect(where).toEqual({ id: { in: ["a", "b", "c"] } });
  });

  it("parses unparenthesized `in` values", () => {
    const where = parseFilters(
      "conversations",
      new URLSearchParams("id=in.a,b"),
    );
    expect(where).toEqual({ id: { in: ["a", "b"] } });
  });

  it("maps like/ilike %wildcards to Prisma operators", () => {
    expect(parseFilters("contacts", new URLSearchParams("name=ilike.%juan%"))).toEqual({
      name: { contains: "juan" },
    });
    expect(parseFilters("contacts", new URLSearchParams("name=like.juan%"))).toEqual({
      name: { startsWith: "juan" },
    });
    expect(parseFilters("contacts", new URLSearchParams("name=ilike.%juan"))).toEqual({
      name: { endsWith: "juan" },
    });
    expect(parseFilters("contacts", new URLSearchParams("name=like.juan"))).toEqual({
      name: { equals: "juan" },
    });
  });

  it("parses is.null", () => {
    expect(parseFilters("notifications", new URLSearchParams("read_at=is.null"))).toEqual({
      readAt: null,
    });
  });

  it("ignores non-filter params (select/order/limit)", () => {
    const where = parseFilters(
      "conversations",
      new URLSearchParams("select=id&order=created_at.desc&limit=10"),
    );
    expect(where).toEqual({});
  });
});
