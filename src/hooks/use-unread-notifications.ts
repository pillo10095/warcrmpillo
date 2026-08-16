"use client";

import { useEffect, useState } from "react";
import type { Notification } from "@/types";

const POLL_INTERVAL_MS = 5_000;

/**
 * Count of unread notifications for the current user. Used by the
 * sidebar to surface a badge on the Notifications nav entry.
 *
 * Polls GET /api/data/notifications every 5 seconds instead of using
 * Supabase Realtime.
 */
export function useUnreadNotifications(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchCount = async () => {
      try {
        const res = await fetch(
          "/api/data/notifications?select=*&read_at=is.null"
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { data?: Notification[] } | Notification[];
        const rows = Array.isArray(json)
          ? json
          : ((json as { data?: Notification[] }).data ?? []);
        if (cancelled) return;
        setCount(rows.length);
      } catch {
        // Network error — skip this tick.
      }
    };

    fetchCount();
    const id = setInterval(fetchCount, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return count;
}
