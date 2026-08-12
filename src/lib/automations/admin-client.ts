import { createSupabaseQueryBuilder, type SupabaseQueryBuilder } from '../supabase/query-builder'

// Lazy, shared service-role client for automation engine work.
let _adminClient: SupabaseQueryBuilder | null = null

export function supabaseAdmin(): SupabaseQueryBuilder {
  if (!_adminClient) {
    _adminClient = createSupabaseQueryBuilder({
      baseUrl: '',
      headers: {
        'x-service-role-key': process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
    })
  }
  return _adminClient
}
