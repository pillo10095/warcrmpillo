import { cookies } from 'next/headers'
import { createSupabaseQueryBuilder, type SupabaseQueryBuilder } from './query-builder'

export async function createClient(): Promise<SupabaseQueryBuilder> {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ')

  return createSupabaseQueryBuilder({
    baseUrl: '',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  })
}
