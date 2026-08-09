import { describe, it, expect } from 'vitest';
import {
  generateWebhookSecret,
  serializeWebhookEndpoint,
  serializePrismaWebhookEndpoint,
  normalizeWebhookUrl,
  WEBHOOK_SECRET_PREFIX,
} from './endpoints';

describe('generateWebhookSecret', () => {
  it('is prefixed and high-entropy, and unique per call', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThan(WEBHOOK_SECRET_PREFIX.length + 20);
    expect(a).not.toBe(b);
  });
});

describe('serializeWebhookEndpoint', () => {
  it('projects public fields and never leaks the secret', () => {
    const out = serializeWebhookEndpoint({
      id: 'w1',
      account_id: 'acct',
      created_by: 'u1',
      url: 'https://example.com/hook',
      secret: 'encrypted-blob',
      events: ['message.received'],
      is_active: true,
      last_delivery_at: null,
      failure_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(out).not.toHaveProperty('secret');
    expect(out).not.toHaveProperty('account_id');
    expect(out).toEqual({
      id: 'w1',
      url: 'https://example.com/hook',
      events: ['message.received'],
      is_active: true,
      last_delivery_at: null,
      failure_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    });
  });
});

describe('serializePrismaWebhookEndpoint', () => {
  it('maps a Prisma row to the public API shape and never leaks the secret', () => {
    const out = serializePrismaWebhookEndpoint({
      id: 'w1',
      accountId: 'acct',
      createdBy: 'u1',
      url: 'https://example.com/hook',
      secret: 'encrypted-blob',
      events: '["message.received"]',
      isActive: true,
      lastDeliveryAt: null,
      failureCount: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(out).not.toHaveProperty('secret');
    expect(out).not.toHaveProperty('accountId');
    expect(out).toEqual({
      id: 'w1',
      url: 'https://example.com/hook',
      events: ['message.received'],
      is_active: true,
      last_delivery_at: null,
      failure_count: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('handles a malformed events payload, inactive state, and timestamps', () => {
    const out = serializePrismaWebhookEndpoint({
      id: 'w2',
      accountId: 'acct',
      createdBy: null,
      url: 'https://example.com/hook',
      secret: 'encrypted-blob',
      events: 'not-json',
      isActive: false,
      lastDeliveryAt: new Date('2026-02-02T03:04:05Z'),
      failureCount: 3,
      createdAt: new Date('2026-02-02T00:00:00Z'),
    });
    expect(out.events).toEqual([]);
    expect(out.is_active).toBe(false);
    expect(out.last_delivery_at).toBe('2026-02-02T03:04:05.000Z');
    expect(out.failure_count).toBe(3);
    expect(out.created_at).toBe('2026-02-02T00:00:00.000Z');
  });
});

describe('normalizeWebhookUrl', () => {
  it('accepts https and normalizes', () => {
    expect(normalizeWebhookUrl('  https://example.com/hook  ')).toBe(
      'https://example.com/hook'
    );
  });

  it('rejects http, non-URLs, and non-strings', () => {
    expect(normalizeWebhookUrl('http://example.com/hook')).toBeNull();
    expect(normalizeWebhookUrl('not a url')).toBeNull();
    expect(normalizeWebhookUrl(123)).toBeNull();
  });
});
