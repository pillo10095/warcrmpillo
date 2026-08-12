import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from './types'

// All dashboard data is fetched from the server-side /api/dashboard
// endpoint, which uses Prisma with proper auth scoping. The old
// Supabase query builder is no longer needed here.

async function fetchDashboard<T>(section: string, params?: Record<string, string>): Promise<T> {
  const sp = new URLSearchParams({ section, ...params })
  const res = await fetch(`/api/dashboard?${sp}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(body.error ?? `Dashboard ${section} failed: ${res.status}`)
  }
  const body = await res.json()
  if (body.error) throw new Error(body.error)
  return body.data as T
}

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(): Promise<MetricsBundle> {
  return fetchDashboard<MetricsBundle>('metrics')
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  return fetchDashboard('series', { days: String(rangeDays) })
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut(): Promise<PipelineDonutData> {
  return fetchDashboard('pipeline')
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(): Promise<ResponseTimeSummary> {
  return fetchDashboard('response-time')
}

// --- 5. Activity feed --------------------------------------------------

export async function loadActivity(limit = 20): Promise<ActivityItem[]> {
  return fetchDashboard('activity', { limit: String(limit) })
}
