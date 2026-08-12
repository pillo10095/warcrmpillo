import { type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser } from '@/lib/auth/session'
import { SESSION_COOKIE } from '@/lib/auth/cookies'
import {
  daysAgoStart,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from '@/lib/dashboard/date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'

export const runtime = 'nodejs'

// ── Auth ──────────────────────────────────────────────────────────

async function authenticate() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null
  return getSessionUser(token)
}

type AuthUser = { userId: string; accountId: string; role: string }

// ── Route handler ─────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await authenticate()
  if (!user) {
    return Response.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  }

  const section = request.nextUrl.searchParams.get('section')
  if (!section) {
    return Response.json({ data: null, error: 'Missing section param' }, { status: 400 })
  }

  try {
    switch (section) {
      case 'metrics':
        return Response.json({ data: await loadMetrics(user), error: null })
      case 'series': {
        const days = Math.min(
          Math.max(parseInt(request.nextUrl.searchParams.get('days') || '30', 10) || 30, 1),
          365,
        )
        return Response.json({ data: await loadSeries(user.accountId, days), error: null })
      }
      case 'pipeline':
        return Response.json({ data: await loadPipeline(user), error: null })
      case 'response-time':
        return Response.json({ data: await loadResponseTime(user.accountId), error: null })
      case 'activity': {
        const limit = Math.min(
          Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '20', 10) || 20, 1),
          100,
        )
        return Response.json({ data: await loadActivity(user, limit), error: null })
      }
      default:
        return Response.json({ data: null, error: `Unknown section: ${section}` }, { status: 400 })
    }
  } catch (e: any) {
    return Response.json({ data: null, error: e.message ?? 'Internal error' }, { status: 500 })
  }
}

// ── 1. Metric cards ───────────────────────────────────────────────

async function loadMetrics(user: AuthUser): Promise<MetricsBundle> {
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()

  const [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    openDeals,
    messagesToday,
    messagesYesterday,
  ] = await Promise.all([
    prisma.conversation.count({
      where: { accountId: user.accountId, status: 'open' },
    }),
    prisma.conversation.count({
      where: { accountId: user.accountId, status: 'open', createdAt: { gte: new Date(todayStart) } },
    }),
    prisma.conversation.count({
      where: {
        accountId: user.accountId,
        status: 'open',
        createdAt: { gte: new Date(yesterdayStart), lt: new Date(todayStart) },
      },
    }),
    prisma.contact.count({
      where: { accountId: user.accountId, createdAt: { gte: new Date(todayStart) } },
    }),
    prisma.contact.count({
      where: {
        accountId: user.accountId,
        createdAt: { gte: new Date(yesterdayStart), lt: new Date(todayStart) },
      },
    }),
    prisma.deal.findMany({
      where: { userId: user.userId, status: 'open' },
      select: { value: true },
    }),
    prisma.message.count({
      where: {
        conversation: { accountId: user.accountId },
        senderType: 'agent',
        createdAt: { gte: new Date(todayStart) },
      },
    }),
    prisma.message.count({
      where: {
        conversation: { accountId: user.accountId },
        senderType: 'agent',
        createdAt: { gte: new Date(yesterdayStart), lt: new Date(todayStart) },
      },
    }),
  ])

  const openDealsValue = openDeals.reduce((sum, d) => sum + Number(d.value), 0)

  return {
    activeConversations: {
      current: openConvCur,
      previous: newConvToday - newConvYesterday,
    },
    newContactsToday: {
      current: newContactsToday,
      previous: newContactsYesterday,
    },
    openDealsValue,
    openDealsCount: openDeals.length,
    messagesSentToday: {
      current: messagesToday,
      previous: messagesYesterday,
    },
  }
}

// ── 2. Conversations over time ────────────────────────────────────

async function loadSeries(
  accountId: string,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1).toISOString()

  const rows = await prisma.message.findMany({
    where: {
      conversation: { accountId },
      createdAt: { gte: new Date(start) },
    },
    select: { createdAt: true, senderType: true },
    orderBy: [{ createdAt: 'asc' }],
  })

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of rows) {
    const key = localDayKey(row.createdAt)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.senderType === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// ── 3. Pipeline donut ─────────────────────────────────────────────

async function loadPipeline(user: AuthUser): Promise<PipelineDonutData> {
  const [stages, deals] = await Promise.all([
    prisma.pipelineStage.findMany({
      where: { pipeline: { userId: user.userId } },
      select: { id: true, name: true, color: true },
      orderBy: { position: 'asc' },
    }),
    prisma.deal.findMany({
      where: { userId: user.userId, status: 'open' },
      select: { stageId: true, value: true },
    }),
  ])

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stageId) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += Number(d.value)
    byStage.set(d.stageId, row)
  }

  const slices = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// ── 4. Response time by day of week ───────────────────────────────

async function loadResponseTime(accountId: string): Promise<ResponseTimeSummary> {
  const fourteenDaysAgo = daysAgoStart(13).toISOString()

  const rows = await prisma.message.findMany({
    where: {
      conversation: { accountId },
      createdAt: { gte: new Date(fourteenDaysAgo) },
    },
    select: { conversationId: true, senderType: true, createdAt: true },
    orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
  })

  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversationId !== currentConv) {
      currentConv = row.conversationId
      pendingCustomer = null
    }
    const ts = row.createdAt
    if (row.senderType === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets = Array.from({ length: 7 }, (_, dow) => ({
    dow,
    avgMinutes: avg(byDow.get(dow) ?? []),
    samples: (byDow.get(dow) ?? []).length,
  }))

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

// ── 5. Activity feed ──────────────────────────────────────────────

async function loadActivity(user: AuthUser, limit: number): Promise<ActivityItem[]> {
  const [msgRows, contactRows, dealRows, broadcastRows, autoLogRows] = await Promise.all([
    prisma.message.findMany({
      where: {
        conversation: { accountId: user.accountId },
        senderType: 'customer',
      },
      select: {
        id: true,
        contentText: true,
        createdAt: true,
        conversationId: true,
        conversation: {
          select: {
            contact: {
              select: { name: true, phone: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.contact.findMany({
      where: { accountId: user.accountId },
      select: { id: true, name: true, phone: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.deal.findMany({
      where: { userId: user.userId },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        stage: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
    prisma.broadcast.findMany({
      where: { accountId: user.accountId },
      select: {
        id: true,
        name: true,
        status: true,
        totalRecipients: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.automationLog.findMany({
      where: { userId: user.userId },
      select: {
        id: true,
        triggerEvent: true,
        status: true,
        createdAt: true,
        automation: { select: { name: true } },
        contact: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  const items: ActivityItem[] = []

  for (const m of msgRows) {
    const who = m.conversation?.contact?.name || m.conversation?.contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.createdAt.toISOString(),
      href: `/inbox?c=${m.conversationId}`,
    })
  }

  for (const c of contactRows) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: c.createdAt.toISOString(),
      href: '/contacts',
    })
  }

  for (const d of dealRows) {
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: d.stage?.name
        ? `Deal "${d.title}" in ${d.stage.name}`
        : `Deal "${d.title}" updated`,
      at: d.updatedAt.toISOString(),
      href: '/pipelines',
    })
  }

  for (const b of broadcastRows) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.totalRecipients} contacts`
        : `${b.status} (${b.totalRecipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.createdAt.toISOString(),
      href: '/broadcasts',
    })
  }

  for (const l of autoLogRows) {
    const who = l.contact?.name || l.contact?.phone || 'a contact'
    const autoName = l.automation?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.createdAt.toISOString(),
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
