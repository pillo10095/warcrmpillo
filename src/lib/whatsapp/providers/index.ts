// ============================================================
// Provider factory — resolves the right WhatsApp backend for a
// conversation. The send core and API routes ask for a provider
// here instead of reaching into either backend's internals.
// ============================================================

import { decrypt } from '@/lib/whatsapp/encryption';
import { prisma } from '@/lib/db/prisma';
import { OpenWAProvider } from './openwa-provider';
import type { WhatsAppProvider } from './types';

export class ProviderNotConfiguredError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
    this.code = code;
  }
}

async function loadOpenWAConfig(accountId: string) {
  const config = await prisma.openWAConfig.findUnique({
    where: { accountId },
    include: { sessions: true },
  });
  if (!config) {
    throw new ProviderNotConfiguredError(
      'openwa_not_configured',
      'OpenWA is not configured for this account. Set it up in Settings first.'
    );
  }
  return config;
}

function buildClient(apiUrl: string, apiKey: string, sessionId: string): OpenWAProvider {
  return new OpenWAProvider({ apiUrl, apiKey, sessionId });
}

/**
 * Build a management client (session create/start/stop/QR/webhook).
 * Management methods take explicit session ids, so the client is
 * constructed without a default sending session.
 */
export async function resolveOpenWAClient(accountId: string): Promise<OpenWAProvider> {
  const config = await loadOpenWAConfig(accountId);
  return buildClient(config.apiUrl, decrypt(config.apiKey), '');
}

/**
 * Build an OpenWAProvider for an account. Loads the account's
 * OpenWA config (decrypting the stored API key) and picks a session
 * to send through — the first "ready" one, falling back to any
 * session so setup status is visible before pairing completes.
 *
 * Throws ProviderNotConfiguredError when the account has no config
 * or no session yet.
 */
export async function resolveOpenWAProvider(
  accountId: string
): Promise<OpenWAProvider> {
  const config = await loadOpenWAConfig(accountId);
  if (config.sessions.length === 0) {
    throw new ProviderNotConfiguredError(
      'openwa_no_session',
      'No OpenWA session exists yet. Create and pair a session before sending.'
    );
  }

  const session =
    config.sessions.find((s) => s.status === 'ready') ?? config.sessions[0];

  return buildClient(config.apiUrl, decrypt(config.apiKey), session.openwaSessionId);
}

/**
 * Named export so callers can depend on the interface rather than
 * the concrete OpenWA class when all they need is send semantics.
 */
export function asProvider(p: OpenWAProvider): WhatsAppProvider {
  return p;
}
