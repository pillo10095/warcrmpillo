/**
 * Map a Prisma `message_templates` row (camelCase) into the snake_case
 * `MessageTemplate` wire shape consumed by the send path
 * (`template-row-guard`, `template-send-builder`). The send core reads
 * templates through Prisma now, but the builders still read the
 * snake_case shape — this mapper is the boundary between the two.
 */

import type { Prisma } from '@prisma/client';

import type { MessageTemplate, TemplateButton, TemplateSampleValues } from '@/types';

type PrismaTemplateRow = Prisma.MessageTemplateGetPayload<Record<string, never>>;

export function prismaTemplateToMessage(row: PrismaTemplateRow): MessageTemplate {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    category: row.category,
    language: row.language ?? undefined,
    header_type: row.headerType ?? undefined,
    header_content: row.headerContent ?? undefined,
    header_handle: row.headerHandle ?? undefined,
    header_media_url: row.headerMediaUrl ?? undefined,
    body_text: row.bodyText,
    footer_text: row.footerText ?? undefined,
    buttons: (row.buttons as unknown as TemplateButton[] | null) ?? undefined,
    sample_values:
      (row.sampleValues as unknown as TemplateSampleValues | null) ?? undefined,
    status: row.status,
    meta_template_id: row.metaTemplateId ?? undefined,
    rejection_reason: row.rejectionReason ?? undefined,
    quality_score: row.qualityScore ?? undefined,
    submission_error: row.submissionError ?? undefined,
    last_submitted_at: row.lastSubmittedAt?.toISOString() ?? undefined,
    created_at: row.createdAt.toISOString(),
  };
}
