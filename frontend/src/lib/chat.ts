import type { ChatMessage, ChatPage } from "../api/types";

/** What the chat panel shows: messages oldest first, and whether older ones can still be loaded. */
export type ChatFeed = { messages: ChatMessage[]; canLoadEarlier: boolean };

function sentAt(message: ChatMessage) {
  const time = Date.parse(message.created_at);
  return Number.isNaN(time) ? 0 : time;
}

function byTime(a: ChatMessage, b: ChatMessage) {
  return sentAt(a) - sentAt(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Merges by id, the newer copy winning, oldest first. */
function mergeMessages(older: ChatMessage[], newer: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  for (const message of older) byId.set(message.id, message);
  for (const message of newer) byId.set(message.id, message);
  return [...byId.values()].sort(byTime);
}

/**
 * Folds the room's latest messages (the newest window from the room state, plus live arrivals)
 * into the feed. Messages that fell out of the window stay. When the window no longer touches the
 * feed, messages were missed in between, so the feed restarts from the window.
 */
export function withLatest(feed: ChatFeed, latest: ChatMessage[], latestHasEarlier: boolean): ChatFeed {
  if (latest.length === 0) return feed.messages.length ? feed : { messages: [], canLoadEarlier: latestHasEarlier };
  const known = new Set(feed.messages.map((message) => message.id));
  if (feed.messages.length === 0 || !latest.some((message) => known.has(message.id))) {
    return { messages: mergeMessages([], latest), canLoadEarlier: latestHasEarlier };
  }
  const messages = mergeMessages(feed.messages, latest);
  // Only while the window still starts the feed does its flag describe the feed's oldest message.
  const canLoadEarlier = messages[0].id === latest[0].id ? latestHasEarlier : feed.canLoadEarlier;
  return { messages, canLoadEarlier };
}

/** Adds a page of earlier messages to the top of the feed. */
export function withEarlier(feed: ChatFeed, page: ChatPage): ChatFeed {
  return { messages: mergeMessages(page.messages, feed.messages), canLoadEarlier: page.hasEarlier };
}

/** Short time for the feed (with the day when it isn't today) and the full date for hovering. */
export function messageTime(createdAt: string, now = new Date()): { short: string; full: string } | null {
  const sent = new Date(createdAt);
  if (Number.isNaN(sent.getTime())) return null;
  const sameDay = sent.toDateString() === now.toDateString();
  const short = sameDay
    ? sent.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : sent.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return { short, full: sent.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }) };
}
