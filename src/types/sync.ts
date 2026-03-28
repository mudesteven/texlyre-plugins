// src/types/sync.ts

export interface SyncUser {
  id: string;
  email: string;
  name: string;
  color: string;
  avatar: string | null;
  created_at: number;
  updated_at: number;
}

export interface SyncProjectMeta {
  id: string;
  title: string;
  type: 'latex' | 'typst';
  tags: string[];
  owner_id: string;
  created_at: number;
  updated_at: number;
}

export interface SyncFileMeta {
  path: string;
  modified: number;
  size: number;
}

export type SyncStatus = 'disabled' | 'connecting' | 'connected' | 'error';

// ── WebSocket message types ──────────────────────────────────────────

export interface WsSubscribe {
  type: 'subscribe';
  project_id: string;
}

export interface WsUnsubscribe {
  type: 'unsubscribe';
  project_id: string;
}

export interface WsFileWrite {
  type: 'file_write';
  project_id: string;
  path: string;
  content: string; // base64
}

export interface WsFileDelete {
  type: 'file_delete';
  project_id: string;
  path: string;
}

export type WsClientMessage = WsSubscribe | WsUnsubscribe | WsFileWrite | WsFileDelete | { type: 'ping' };

export interface WsSubscribed {
  type: 'subscribed';
  project_id: string;
  files: SyncFileMeta[];
}

export interface WsFileChanged {
  type: 'file_changed';
  project_id: string;
  path: string;
  content: string; // base64
  by: string; // user_id or 'external'
}

export interface WsFileDeleted {
  type: 'file_deleted';
  project_id: string;
  path: string;
}

export type WsServerMessage =
  | WsSubscribed
  | WsFileChanged
  | WsFileDeleted
  | { type: 'pong' }
  | { type: 'error'; message: string };
