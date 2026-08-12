import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    messageTemplate: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from './template-webhook';

const mockedFindMany = prisma.messageTemplate.findMany as ReturnType<typeof vi.fn>;
const mockedUpdateMany = prisma.messageTemplate.updateMany as ReturnType<typeof vi.fn>;

describe('isTemplateWebhookField', () => {
  it('recognises the three template fields', () => {
    expect(isTemplateWebhookField('message_template_status_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_quality_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_components_update')).toBe(
      true,
    );
  });
  it('rejects messaging fields', () => {
    expect(isTemplateWebhookField('messages')).toBe(false);
    expect(isTemplateWebhookField('message_status')).toBe(false);
  });
});

describe('handleTemplateWebhookChange — status update', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
    mockedFindMany.mockResolvedValue([{ id: 'row-1' }]);
    mockedUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('flips status to APPROVED and clears any rejection_reason', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: {
        event: 'APPROVED',
        message_template_id: 12345,
        message_template_name: 'order_confirmation',
        message_template_language: 'en_US',
      },
    });
    // meta_template_id is coerced to string, matching the TEXT column.
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: { metaTemplateId: '12345' },
      select: { id: true },
    });
    expect(mockedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'APPROVED',
          rejectionReason: null,
          submissionError: null,
        },
      }),
    );
  });

  it('persists the reason field on REJECTED', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: {
        event: 'REJECTED',
        message_template_id: 'TMPL_99',
        reason: 'Template uses non-compliant language.',
      },
    });
    expect(mockedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'REJECTED',
          rejectionReason: 'Template uses non-compliant language.',
        },
      }),
    );
  });

  it('falls back to a generic reason when REJECTED has no `reason`', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: { event: 'REJECTED', message_template_id: '7' },
    });
    expect(mockedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { rejectionReason: 'Rejected by Meta' },
      }),
    );
  });

  it('normalises PENDING_REVIEW → PENDING (via shared normalizeStatus)', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: { event: 'PENDING_REVIEW', message_template_id: '1' },
    });
    expect(mockedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING' } }),
    );
  });

  it('logs and exits when meta_template_id is missing (no UPDATE issued)', async () => {
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: { event: 'APPROVED' },
    });
    expect(mockedFindMany).not.toHaveBeenCalled();
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  it('logs a warning when the row is unknown locally (zero matches)', async () => {
    const warn = vi.spyOn(console, 'warn');
    mockedFindMany.mockResolvedValue([]);
    await handleTemplateWebhookChange({
      field: 'message_template_status_update',
      value: {
        event: 'APPROVED',
        message_template_id: 'NEVER_SEEN',
        message_template_name: 'mystery',
      },
    });
    expect(warn).toHaveBeenCalled();
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });
});

describe('handleTemplateWebhookChange — quality update', () => {
  it('sets quality_score from new_quality_score', async () => {
    mockedFindMany.mockResolvedValue([]);
    mockedUpdateMany.mockResolvedValue({ count: 1 });
    await handleTemplateWebhookChange({
      field: 'message_template_quality_update',
      value: {
        message_template_id: '99',
        previous_quality_score: 'GREEN',
        new_quality_score: 'YELLOW',
      },
    });
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { metaTemplateId: '99' },
      data: { qualityScore: 'YELLOW' },
    });
  });

  it('stores null for unrecognised quality scores', async () => {
    mockedFindMany.mockResolvedValue([]);
    mockedUpdateMany.mockResolvedValue({ count: 1 });
    await handleTemplateWebhookChange({
      field: 'message_template_quality_update',
      value: {
        message_template_id: '99',
        new_quality_score: 'PURPLE', // not a real Meta value
      },
    });
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { metaTemplateId: '99' },
      data: { qualityScore: null },
    });
  });
});

describe('handleTemplateWebhookChange — components update', () => {
  it('is an info-log no-op (does not write to DB)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await handleTemplateWebhookChange({
      field: 'message_template_components_update',
      value: {
        message_template_id: '5',
        message_template_name: 'x',
      },
    });
    expect(mockedUpdateMany).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });
});

describe('handleTemplateWebhookChange — unknown field', () => {
  it('is a defensive no-op', async () => {
    await handleTemplateWebhookChange(
      // Pretend Meta added a new template_* field we don't know about.
      // The route handler pre-filters via isTemplateWebhookField, but
      // the dispatch should still be safe if the filter is bypassed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { field: 'message_template_future_field' as any, value: {} },
    );
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });
});