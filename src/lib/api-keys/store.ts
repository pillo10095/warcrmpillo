// ============================================================
// API key store — the *auth-path* data access for public API keys.
//
// MySQL-backed: this module now re-exports the Prisma store so the
// auth path reads `api_keys` directly instead of via the Supabase
// service-role client. Only the read side lives here, and deliberately
// so — a public-API caller has no session, so the key hash lookup
// itself establishes the account. The management side (list / create /
// revoke) runs in the dashboard under a real cookie session.
//
// Consumers import from this module (not `./store-mysql`) so the
// exported names stay stable: `findActiveKeyByHash`, `getAccountName`,
// `touchLastUsed`, `ApiKeyRow`.
// ============================================================

export { findActiveKeyByHash, getAccountName, touchLastUsed } from "./store-mysql";
export type { ApiKeyRow } from "./store-mysql";
