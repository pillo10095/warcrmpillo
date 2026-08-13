import crypto from 'crypto'

/**
 * OpenWA webhook signature verification.
 *
 * OpenWA signs every delivery with HMAC-SHA256 over the RAW request
 * body, sent as `X-OpenWA-Signature: sha256=<hex>`. The secret is the
 * webhook's configured secret — we use the instance-wide
 * `OPENWA_WEBHOOK_SECRET` so every session's webhook registers with
 * the same value.
 *
 * Mirrors `verifyMetaWebhookSignature`: fail-closed when the secret or
 * header is missing, constant-time compare. Callers MUST verify on the
 * raw body string (not a re-serialized parse), then JSON.parse.
 */
export function verifyOpenWAWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.OPENWA_WEBHOOK_SECRET
  if (!secret) return false
  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
