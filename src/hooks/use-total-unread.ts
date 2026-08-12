"use client";

import { useEffect, useState } from "react";
import type { Conversation } from "@/types";

const POLL_INTERVAL_MS = 5_000;

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * Polls GET /api/data/conversations every 5 seconds instead of using
 * Supabase Realtime.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchCount = async () => {
      try {
        const res = await fetch(
          "/api/data/conversations?select=id,unread_count"
        );
        if (!res.ok || cancelled) return;
        const rows = (await res.json()) as { id: string; unread_count: number }[];
        if (cancelled) return;

        let sum = 0;
        for (const row of rows) {
          if ((row.unread_count ?? 0) > 0) sum += 1;
        }
        setTotal(sum);
      } catch {
        // Network error — skip this tick, retry next interval.
      }
    };

    fetchCount();
    const id = setInterval(fetchCount, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return total;
}
