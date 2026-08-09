import { prisma } from '@/lib/db/prisma';
import { isUniqueViolation } from './dedupe';

export class ContactTagWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ContactTagWriteError';
    this.status = status;
  }
}

interface ContactTagWriteInput {
  accountId: string;
  contactId: string;
  tagId: string;
}

async function assertContactAndTagOwnership(
  _db: unknown,
  input: ContactTagWriteInput
): Promise<void> {
  try {
    const [contact, tag] = await Promise.all([
      prisma.contact.findFirst({
        where: { id: input.contactId, accountId: input.accountId },
        select: { id: true },
      }),
      prisma.tag.findFirst({
        where: { id: input.tagId, accountId: input.accountId },
        select: { id: true },
      }),
    ]);

    if (!contact) {
      throw new ContactTagWriteError('Contact not found', 404);
    }
    if (!tag) {
      throw new ContactTagWriteError('Tag not found', 404);
    }
  } catch (error) {
    if (error instanceof ContactTagWriteError) throw error;
    throw new ContactTagWriteError('Could not verify contact tag ownership');
  }
}

/**
 * Add a tag exactly once. The unique constraint on
 * (contact_id, tag_id) is the concurrency-safe source of truth: a
 * duplicate insert is a no-op and must not emit a tag_added event.
 */
export async function addContactTagIfAbsent(
  _db: unknown,
  input: ContactTagWriteInput
): Promise<boolean> {
  await assertContactAndTagOwnership(_db, input);

  try {
    await prisma.contactTag.create({
      data: { contactId: input.contactId, tagId: input.tagId },
      select: { id: true },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw new ContactTagWriteError(
      `Failed to add contact tag: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function removeContactTag(
  _db: unknown,
  input: ContactTagWriteInput
): Promise<void> {
  await assertContactAndTagOwnership(_db, input);

  try {
    await prisma.contactTag.deleteMany({
      where: { contactId: input.contactId, tagId: input.tagId },
    });
  } catch (error) {
    throw new ContactTagWriteError(
      `Failed to remove contact tag: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
