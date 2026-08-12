"use client";

import { useEffect, useRef, useState } from "react";
import type { Message, Conversation } from "@/types";

const POLL_INTERVAL_MS = 5_000;

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
}

/**
 * Polls for messages and conversation changes every 5 seconds instead
 * of using Supabase Realtime postgres_changes subscriptions.
 *
 * Keeps the same return interface (`isConnected`, `unsubscribe`).
 * `isConnected` is always true after mount (we have a polling loop).
 */
export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);

  // Store latest callbacks in refs so the polling loop always calls
  // the freshest closures without re-subscribing on every render.
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  const prevMessagesRef = useRef<Map<string, Message>>(new Map());
  const prevConversationsRef = useRef<Map<string, Conversation>>(new Map());

  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const poll = async () => {
      try {
        // Fetch recent messages (last 50).
        if (onMessageRef.current) {
          const msgRes = await fetch(
            "/api/data/messages?select=*&order=created_at.desc&limit=50"
          );
          if (msgRes.ok && !cancelled) {
            const msgs = (await msgRes.json()) as Message[];
            const prev = prevMessagesRef.current;

            for (const msg of msgs) {
              const existing = prev.get(msg.id);
              if (!existing) {
                // New message — INSERT
                onMessageRef.current({
                  eventType: "INSERT",
                  new: msg,
                  old: {},
                });
              } else if (
                JSON.stringify(existing) !== JSON.stringify(msg)
              ) {
                // Changed — UPDATE
                onMessageRef.current({
                  eventType: "UPDATE",
                  new: msg,
                  old: existing,
                });
              }
            }

            // Detect DELETEs: ids that were in prev but not in current fetch
            if (prev.size > 0) {
              const currentIds = new Set(msgs.map((m) => m.id));
              for (const [id, oldMsg] of prev) {
                if (!currentIds.has(id)) {
                  onMessageRef.current({
                    eventType: "DELETE",
                    new: oldMsg,
                    old: oldMsg,
                  });
                }
              }
            }

            const next = new Map<string, Message>();
            for (const m of msgs) next.set(m.id, m);
            prevMessagesRef.current = next;
          }
        }

        // Fetch recent conversations (last 50).
        if (onConversationRef.current) {
          const convRes = await fetch(
            "/api/data/conversations?select=*&order=last_message_at.desc&limit=50"
          );
          if (convRes.ok && !cancelled) {
            const convs = (await convRes.json()) as Conversation[];
            const prev = prevConversationsRef.current;

            for (const conv of convs) {
              const existing = prev.get(conv.id);
              if (!existing) {
                onConversationRef.current({
                  eventType: "INSERT",
                  new: conv,
                  old: {},
                });
              } else if (
                JSON.stringify(existing) !== JSON.stringify(conv)
              ) {
                onConversationRef.current({
                  eventType: "UPDATE",
                  new: conv,
                  old: existing,
                });
              }
            }

            if (prev.size > 0) {
              const currentIds = new Set(convs.map((c) => c.id));
              for (const [id, oldConv] of prev) {
                if (!currentIds.has(id)) {
                  onConversationRef.current({
                    eventType: "DELETE",
                    new: oldConv,
                    old: oldConv,
                  });
                }
              }
            }

            const next = new Map<string, Conversation>();
            for (const c of convs) next.set(c.id, c);
            prevConversationsRef.current = next;
          }
        }
      } catch {
        // Network error — skip this tick.
      }
    };

    // Initial fetch to populate the prev refs so the first poll
    // doesn't fire INSERT events for every existing row.
    (async () => {
      try {
        if (onMessageRef.current) {
          const msgRes = await fetch(
            "/api/data/messages?select=*&order=created_at.desc&limit=50"
          );
          if (msgRes.ok && !cancelled) {
            const msgs = (await msgRes.json()) as Message[];
            const map = new Map<string, Message>();
            for (const m of msgs) map.set(m.id, m);
            prevMessagesRef.current = map;
          }
        }
        if (onConversationRef.current) {
          const convRes = await fetch(
            "/api/data/conversations?select=*&order=last_message_at.desc&limit=50"
          );
          if (convRes.ok && !cancelled) {
            const convs = (await convRes.json()) as Conversation[];
            const map = new Map<string, Conversation>();
            for (const c of convs) map.set(c.id, c);
            prevConversationsRef.current = map;
          }
        }
      } catch {
        // Ignore — polling will pick up on next tick.
      }

      if (!cancelled) setIsConnected(true);
    })();

    const id = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
      setIsConnected(false);
    };
  }, [channelName, enabled]);

  const unsubscribe = useRef(() => {
    // No-op — polling stops on unmount via effect cleanup.
  });

  return { isConnected, unsubscribe: unsubscribe.current };
}
