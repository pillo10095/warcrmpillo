import { createSupabaseQueryBuilder, type SupabaseQueryBuilder } from './query-builder'

// Singleton — one client shared across the whole browser session.
let _client: SupabaseQueryBuilder | undefined

export function createClient(): SupabaseQueryBuilder {
  if (_client) return _client

  _client = createSupabaseQueryBuilder({
    baseUrl: '',
    headers: {},
  })

  return _client
}
