import { useEffect, useState } from 'react';

import type { ProgressEvent } from '@outreach/shared';

import { asNumber, asString, isRecord, oneOf } from './api';
import { engineApiBase, engineAuthQuery } from './engine';

export type DiscoveryProgressEvent = Extract<ProgressEvent, { type: 'discovery' }>;
export type QueueProgressEvent = Extract<ProgressEvent, { type: 'queue' }>;
export type LogProgressEvent = Extract<ProgressEvent, { type: 'log' }>;
export type LeadProgressEvent = Extract<ProgressEvent, { type: 'lead' }>;

/** EventSource cannot set headers, so the token travels in the query string. */
export function eventsUrl(): string {
  const base = `${engineApiBase()}/events`;
  const query = engineAuthQuery();
  return query ? `${base}?${query}` : base;
}

/** Lenient parser: an unrecognised frame is dropped instead of throwing mid-stream. */
export function parseProgressEvent(raw: unknown): ProgressEvent | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  switch (asString(parsed.type)) {
    case 'hello':
      return { type: 'hello', at: asNumber(parsed.at) ?? Date.now() };
    case 'ping':
      return { type: 'ping', at: asNumber(parsed.at) ?? Date.now() };
    case 'discovery': {
      const queryId = asNumber(parsed.queryId);
      if (queryId === null) return null;
      return {
        type: 'discovery',
        queryId,
        status: asString(parsed.status) ?? 'unknown',
        poisFound: asNumber(parsed.poisFound) ?? 0,
        tilesDone: asNumber(parsed.tilesDone) ?? 0,
        tilesTotal: asNumber(parsed.tilesTotal) ?? 0,
        mirror: asString(parsed.mirror),
      };
    }
    case 'queue':
      return { type: 'queue', pending: asNumber(parsed.pending) ?? 0, inFlight: asNumber(parsed.inFlight) ?? 0 };
    case 'lead': {
      const businessId = asNumber(parsed.businessId);
      if (businessId === null) return null;
      return {
        type: 'lead',
        businessId,
        stage: asString(parsed.stage) ?? 'unknown',
        state: asString(parsed.state) ?? 'unknown',
        score: asNumber(parsed.score),
      };
    }
    case 'log':
      return {
        type: 'log',
        level: oneOf(['info', 'warn', 'error'] as const, parsed.level) ?? 'info',
        message: asString(parsed.message) ?? '',
        at: asNumber(parsed.at) ?? Date.now(),
      };
    default:
      return null;
  }
}

export interface ProgressStream {
  /** The EventSource handshake succeeded. */
  connected: boolean;
  /** SSE is unsupported or the stream keeps failing — show a plain notice rather than a lie. */
  unavailable: boolean;
  discovery: DiscoveryProgressEvent | null;
  queue: QueueProgressEvent | null;
  logs: LogProgressEvent[];
  lastEventAt: number | null;
}

const INITIAL: ProgressStream = {
  connected: false,
  unavailable: typeof EventSource === 'undefined',
  discovery: null,
  queue: null,
  logs: [],
  lastEventAt: null,
};

const MAX_LOGS = 8;

function applyEvent(state: ProgressStream, event: ProgressEvent): ProgressStream {
  switch (event.type) {
    case 'discovery':
      return { ...state, discovery: event, lastEventAt: Date.now() };
    case 'queue':
      return { ...state, queue: event, lastEventAt: Date.now() };
    case 'log':
      return {
        ...state,
        logs: [...state.logs, event].slice(-MAX_LOGS),
        lastEventAt: Date.now(),
      };
    default:
      return { ...state, lastEventAt: Date.now() };
  }
}

/**
 * Subscribe to `GET /api/events` (Server-Sent Events) with exponential-backoff reconnects.
 * Returns the most recent frame of each kind; the caller decides how to render it.
 */
export function useProgressStream(options: { enabled?: boolean } = {}): ProgressStream {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<ProgressStream>(INITIAL);

  useEffect(() => {
    if (!enabled) return;
    if (typeof EventSource === 'undefined') {
      setState((prev) => (prev.unavailable ? prev : { ...prev, unavailable: true, connected: false }));
      return;
    }

    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      source = new EventSource(eventsUrl());

      source.onopen = () => {
        attempt = 0;
        setState((prev) => ({ ...prev, connected: true, unavailable: false }));
      };

      source.onmessage = (message: MessageEvent<unknown>) => {
        const event = parseProgressEvent(message.data);
        if (!event) return;
        setState((prev) => applyEvent(prev, event));
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (disposed) return;
        attempt = Math.min(attempt + 1, 6);
        setState((prev) => ({ ...prev, connected: false, unavailable: attempt >= 3 }));
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempt, 20_000));
      };
    };

    connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [enabled]);

  return state;
}
