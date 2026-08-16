"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  derivePresence,
  type PresenceRow,
  type PresenceStatus,
  type StoredPresence,
} from "@/lib/presence";

const POLL_INTERVAL_MS = 5_000;
const RE_DERIVE_MS = 15_000;

type PresenceMap = Map<string, PresenceRow>;

interface UsePresenceResult {
  /** Derived status for one member (defaults to offline if unseen). */
  getPresence: (userId: string) => PresenceStatus;
  /** Raw row for tooltips ("last seen …"). */
  getRow: (userId: string) => PresenceRow | undefined;
  /**
   * The clock value the hook is currently deriving against. Pass this
   * to `presenceLabel` / `formatLastSeen` so labels stay in lockstep
   * with the dots (both advance on the same ~15s re-derive tick).
   */
  now: number;
}

/**
 * Live presence for every member of the caller's account. Reads the
 * `member_presence` table (RLS-scoped to the account) and re-derives
 * "offline" on a local timer.
 *
 * Polls GET /api/data/member_presence every 5 seconds instead of using
 * Supabase Realtime.
 *
 * Account comes from useAuth; pass `enabled: false` to opt a consumer
 * out (e.g. while a parent sheet is closed).
 */
export function usePresence(enabled = true): UsePresenceResult {
  const { accountId } = useAuth();

  const [rows, setRows] = useState<PresenceMap>(() => new Map());
  const [now, setNow] = useState(() => Date.now());

  const active = enabled && !!accountId;

  useEffect(() => {
    if (!active || !accountId) return;

    let cancelled = false;

    const fetchPresence = async () => {
      try {
        const res = await fetch(
          `/api/data/member_presence?select=user_id,status,last_seen_at&account_id=eq.${accountId}`
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as
          | { data?: { user_id: string; status: StoredPresence; last_seen_at: string }[] }
          | { user_id: string; status: StoredPresence; last_seen_at: string }[];
        const data = Array.isArray(json)
          ? json
          : ((json as { data?: { user_id: string; status: StoredPresence; last_seen_at: string }[] })
              .data ?? []);
        if (cancelled) return;

        setRows((prev) => {
          const next = new Map(prev);
          for (const r of data) {
            const incoming: PresenceRow = {
              status: r.status,
              last_seen_at: r.last_seen_at,
            };
            const existing = next.get(r.user_id);
            if (
              !existing ||
              new Date(incoming.last_seen_at) >= new Date(existing.last_seen_at)
            ) {
              next.set(r.user_id, incoming);
            }
          }
          return next;
        });
      } catch {
        // Network error — skip this tick.
      }
    };

    fetchPresence();
    const pollId = setInterval(fetchPresence, POLL_INTERVAL_MS);
    const tick = setInterval(() => setNow(Date.now()), RE_DERIVE_MS);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(tick);
    };
  }, [active, accountId]);

  const getRow = useCallback(
    (userId: string): PresenceRow | undefined => rows.get(userId),
    [rows],
  );

  const getPresence = useCallback(
    (userId: string): PresenceStatus => {
      const row = rows.get(userId);
      return derivePresence(row?.status, row?.last_seen_at, now);
    },
    [rows, now],
  );

  return { getPresence, getRow, now };
}
