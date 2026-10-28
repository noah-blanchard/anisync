"use client";

import { useRef } from "react";

/**
 * Keeps the first order seen for the current page view, so a card does not jump
 * away from under the thumb after +1. New keys are prepended; `resetToken` changes
 * (refresh, filter, sort) start a fresh order.
 */
export function useStableOrder<T extends { key: string }>(items: T[], resetToken: unknown): T[] {
  const order = useRef<string[]>([]);
  const token = useRef<unknown>(Symbol("init"));

  if (token.current !== resetToken) {
    token.current = resetToken;
    order.current = items.map((i) => i.key);
  }

  const known = new Set(order.current);
  const fresh = items.filter((i) => !known.has(i.key)).map((i) => i.key);
  if (fresh.length > 0) order.current = [...fresh, ...order.current];

  const byKey = new Map(items.map((i) => [i.key, i]));
  return order.current.map((k) => byKey.get(k)).filter((i): i is T => i !== undefined);
}
