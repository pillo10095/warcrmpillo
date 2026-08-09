// ============================================================
// GET  /api/v1/contacts  — list contacts (scope: contacts:read)
// POST /api/v1/contacts  — create a contact  (scope: contacts:write)
//
// List is keyset-paginated (see src/lib/api/v1/pagination.ts) and
// supports `?search=` (name/phone) and `?tag=<tagId>` filters. Create
// is find-or-create by phone: an existing match returns 200 with
// `created: false`; a new row returns 201 with `created: true`.
//
// Prisma-backed (Task B): all queries are explicitly scoped by
// `ctx.accountId` (application-level RLS).
// ============================================================

import type { Prisma } from '@prisma/client';

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, buildPage } from '@/lib/api/v1/pagination';
import {
  CONTACT_SELECT,
  serializeContact,
  findOrCreateContact,
  setContactTags,
  getContactById,
  resolveAuditUserId,
  ContactError,
} from '@/lib/api/v1/contacts';
import { prisma } from '@/lib/db/prisma';

// PostgREST filter values are comma/paren-delimited; strip anything
// that could break the `.or()` grammar before interpolating a search
// term. Leaves the characters a phone or name legitimately contains.
function sanitizeSearch(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} +@.\-_]/gu, '').trim();
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const search = sanitizeSearch(url.searchParams.get('search') ?? '');
    const tag = url.searchParams.get('tag');

    // Search and the keyset walk are both OR-groups; combine them with
    // AND so they never collide in a single `where.OR`.
    const and: Prisma.ContactWhereInput[] = [];
    const searchOr: Prisma.ContactWhereInput[] = [];
    const keysetOr: Prisma.ContactWhereInput[] = [];

    if (search) {
      searchOr.push(
        { name: { contains: search } },
        { phone: { contains: search } }
      );
    }

    if (cursor) {
      // Walks *past* the cursor row under a (created_at desc, id desc)
      // ordering — the Prisma equivalent of the PostgREST keyset filter.
      const at = new Date(cursor.createdAt);
      keysetOr.push(
        { createdAt: { lt: at } },
        { AND: [{ createdAt: at }, { id: { lt: cursor.id } }] }
      );
    }

    if (searchOr.length > 0) and.push({ OR: searchOr });
    if (keysetOr.length > 0) and.push({ OR: keysetOr });

    const where: Prisma.ContactWhereInput = { accountId: ctx.accountId };
    if (tag) where.contactTags = { some: { tagId: tag } };
    if (and.length > 0) where.AND = and;

    let rows;
    try {
      rows = await prisma.contact.findMany({
        where,
        include: CONTACT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
    } catch (error) {
      console.error('[api/v1/contacts] list error:', error);
      return fail('internal', 'Failed to list contacts', 500);
    }

    // buildPage expects the `created_at` ISO string the old PostgREST
    // rows carried; feed it a projection, then serialize the originals.
    const { items, nextCursor } = buildPage(
      rows.map((r) => ({ created_at: r.createdAt.toISOString(), id: r.id })),
      limit
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return okList(
      items.map((r) =>
        serializeContact(byId.get(r.id) as unknown as Record<string, unknown>)
      ),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phone) {
      return fail('bad_request', "'phone' is required", 400);
    }

    const auditUserId = await resolveAuditUserId(undefined, ctx.accountId);

    const { id, created } = await findOrCreateContact(
      undefined,
      ctx.accountId,
      auditUserId,
      {
        phone,
        name: typeof body.name === 'string' ? body.name : undefined,
        email: typeof body.email === 'string' ? body.email : undefined,
        company: typeof body.company === 'string' ? body.company : undefined,
      }
    );

    if (Array.isArray(body.tags)) {
      await setContactTags(
        undefined,
        ctx.accountId,
        auditUserId,
        id,
        body.tags.filter((t): t is string => typeof t === 'string')
      );
    }

    const contact = await getContactById(undefined, ctx.accountId, id);
    return ok(contact, created ? 201 : 200);
  } catch (err) {
    if (err instanceof ContactError) {
      return fail(
        err.status === 400 ? 'bad_request' : 'internal',
        err.message,
        err.status
      );
    }
    return toApiErrorResponse(err);
  }
}
