import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db/prisma'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    conversation: { updateMany: vi.fn() },
  },
}))

import { reopenClosedConversation } from './reopen'

const mockedUpdateMany = prisma.conversation.updateMany as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reopenClosedConversation', () => {
  it('flips a closed conversation back to open', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 1 })

    const reopened = await reopenClosedConversation({
      id: 'conv-1',
      status: 'closed',
    })

    expect(reopened).toBe(true)
    expect(mockedUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockedUpdateMany.mock.calls[0][0]).toMatchObject({
      data: { status: 'open' },
    })
    expect(mockedUpdateMany.mock.calls[0][0].data).toHaveProperty('updatedAt')
  })

  it('guards the write in SQL on the row still being closed', async () => {
    // Without this filter, two concurrent inbound deliveries both holding a
    // stale `status: 'closed'` could write 'open' over an agent's re-close.
    mockedUpdateMany.mockResolvedValue({ count: 1 })

    await reopenClosedConversation({ id: 'conv-1', status: 'closed' })

    expect(mockedUpdateMany.mock.calls[0][0].where).toEqual({
      id: 'conv-1',
      status: 'closed',
    })
  })

  it.each(['open', 'pending'])(
    'issues no query for a %s conversation',
    async (status) => {
      const reopened = await reopenClosedConversation({
        id: 'conv-1',
        status,
      })

      expect(reopened).toBe(false)
      expect(mockedUpdateMany).not.toHaveBeenCalled()
    },
  )

  it('issues no query when status is missing', async () => {
    expect(await reopenClosedConversation({ id: 'conv-1' })).toBe(false)
    expect(mockedUpdateMany).not.toHaveBeenCalled()
  })

  it('swallows a failed update so inbound processing continues', async () => {
    // Throwing here would abort the webhook and make Meta redeliver the
    // message — a worse outcome than a thread that stays closed.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedUpdateMany.mockRejectedValue(new Error('permission denied'))

    await expect(
      reopenClosedConversation({ id: 'conv-1', status: 'closed' }),
    ).resolves.toBe(false)

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})