import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
}));

vi.mock('./tag-write', () => ({
  addContactTagIfAbsent: mocks.add,
}));

import {
  addContactTagAndDispatch,
  getTagChainDepth,
  MAX_TAG_CHAIN_DEPTH,
} from './tag-events';

const base = {
  db: undefined,
  accountId: 'account-1',
  contactId: 'contact-1',
  tagId: 'tag-1',
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.add.mockReset();
  mocks.add.mockResolvedValue(true);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('addContactTagAndDispatch', () => {
  it('adds the tag and defers the automations dispatch (no-op, Task E)', async () => {
    const result = await addContactTagAndDispatch({
      ...base,
      context: { vars: { source: 'flow', _tag_chain_depth: 1 } },
    });

    expect(result).toEqual({ added: true, dispatched: false });
    expect(mocks.add).toHaveBeenCalledWith(base.db, {
      accountId: 'account-1',
      contactId: 'contact-1',
      tagId: 'tag-1',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('tag_added dispatch deferred')
    );
  });

  it('does not add or dispatch when the tag already exists', async () => {
    mocks.add.mockResolvedValue(false);

    await expect(addContactTagAndDispatch(base)).resolves.toEqual({
      added: false,
      dispatched: false,
      reason: 'duplicate',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('adds the tag but reports a cut chain at the depth limit', async () => {
    await expect(
      addContactTagAndDispatch({
        ...base,
        context: { vars: { _tag_chain_depth: MAX_TAG_CHAIN_DEPTH } },
      })
    ).resolves.toEqual({
      added: true,
      dispatched: false,
      reason: 'max_depth',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('chain depth limit reached'),
      expect.objectContaining({ accountId: 'account-1', tagId: 'tag-1' })
    );
  });
});

describe('getTagChainDepth', () => {
  it('normalizes missing, invalid and fractional values', () => {
    expect(getTagChainDepth()).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: '3' } })).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: -1 } })).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: 2.8 } })).toBe(2);
  });
});
