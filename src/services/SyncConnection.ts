// src/services/SyncConnection.ts
// WebSocket wrapper with auto-reconnect, heartbeat, and typed messages.

import type { WsClientMessage, WsServerMessage } from '../types/sync';

type EventMap = {
  connected: void;
  disconnected: void;
  file_changed: Extract<WsServerMessage, { type: 'file_changed' }>;
  file_deleted: Extract<WsServerMessage, { type: 'file_deleted' }>;
  subscribed: Extract<WsServerMessage, { type: 'subscribed' }>;
  error: string;
};

type Handler<K extends keyof EventMap> = EventMap[K] extends void
  ? () => void
  : (data: EventMap[K]) => void;

export class SyncConnection {
  private ws: WebSocket | null = null;
  private url = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1000;
  private readonly maxDelay = 30_000;
  private closed = false; // true when disconnect() called intentionally

  // biome-ignore lint/suspicious/noExplicitAny: generic handler map
  private handlers: Map<string, Set<(...args: any[]) => void>> = new Map();

  connect(url: string) {
    this.url = url;
    this.closed = false;
    this.reconnectDelay = 1000;
    this.open();
  }

  disconnect() {
    this.closed = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private open() {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.startPing();
      this.emit('connected');
    };

    ws.onmessage = (ev) => {
      try {
        const msg: WsServerMessage = JSON.parse(ev.data as string);
        switch (msg.type) {
          case 'file_changed':
            this.emit('file_changed', msg);
            break;
          case 'file_deleted':
            this.emit('file_deleted', msg);
            break;
          case 'subscribed':
            this.emit('subscribed', msg);
            break;
          case 'error':
            this.emit('error', msg.message);
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      this.clearTimers();
      this.emit('disconnected');
      if (!this.closed) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after onerror, so no need to reconnect here
    };
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this.open();
    }, this.reconnectDelay);
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30_000);
  }

  private clearTimers() {
    if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer);
    if (this.pingTimer != null) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  send(msg: WsClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  subscribe(projectId: string) {
    this.send({ type: 'subscribe', project_id: projectId });
  }

  unsubscribe(projectId: string) {
    this.send({ type: 'unsubscribe', project_id: projectId });
  }

  sendFileWrite(projectId: string, path: string, content: string | ArrayBuffer) {
    const b64 =
      typeof content === 'string'
        ? btoa(unescape(encodeURIComponent(content)))
        : btoa(String.fromCharCode(...new Uint8Array(content)));
    this.send({ type: 'file_write', project_id: projectId, path, content: b64 });
  }

  sendFileDelete(projectId: string, path: string) {
    this.send({ type: 'file_delete', project_id: projectId, path });
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Event emitter ────────────────────────────────────────────────────

  on<K extends keyof EventMap>(event: K, handler: Handler<K>) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as (...args: unknown[]) => void);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<K>) {
    this.handlers.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  private emit<K extends keyof EventMap>(event: K, ...args: EventMap[K] extends void ? [] : [EventMap[K]]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }
}

export const syncConnection = new SyncConnection();
