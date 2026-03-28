// src/hooks/useSyncServer.ts
// Manages the sync server WebSocket connection and two-way file sync.

import { useCallback, useEffect, useRef, useState, createElement } from 'react';
import { syncConnection } from '../services/SyncConnection';
import { syncServerService } from '../services/SyncServerService';
import { fileStorageService } from '../services/FileStorageService';
import type { SyncFileMeta, SyncStatus, WsFileChanged, WsFileDeleted, WsSubscribed } from '../types/sync';
import { useSettings } from './useSettings';
import { SyncServerControls } from '../components/settings/SyncServerControls';

interface FileStoredEvent extends CustomEvent {
  detail: { fileId: string; path: string; projectId: string };
}

/** Decode a base64 string to a UTF-8 string or raw ArrayBuffer. */
function b64ToContent(b64: string, isBinary: boolean): string | ArrayBuffer {
  const binary = atob(b64);
  if (isBinary) {
    const buf = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
    return buf;
  }
  return decodeURIComponent(escape(binary));
}

function isBinaryPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'zip', 'woff', 'woff2'].includes(ext);
}


export function useSyncServer() {
  const { getSetting, registerSetting } = useSettings();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disabled');
  const activeProjectRef = useRef<string | null>(null);

  // Register settings once
  useEffect(() => {
    registerSetting({
      id: 'sync-server-enabled',
      label: 'Enable Sync Server',
      type: 'checkbox',
      defaultValue: false,
      category: 'Sync',
      subcategory: 'Server',
    });
    registerSetting({
      id: 'sync-server-url',
      label: 'Sync Server URL',
      type: 'text',
      defaultValue: 'http://localhost:7331',
      category: 'Sync',
      subcategory: 'Server',
      description: createElement(SyncServerControls),
    });
  }, [registerSetting]);

  const isEnabled = (): boolean => {
    const v = getSetting('sync-server-enabled')?.value;
    return v === true || v === 'true';
  };

  const getUrl = (): string => {
    return (getSetting('sync-server-url')?.value as string) ?? 'http://localhost:7331';
  };

  // ── Handle incoming file_changed from server ───────────────────────

  const onFileChanged = useCallback(async (msg: WsFileChanged) => {
    const projectId = fileStorageService.getCurrentProjectId();
    if (msg.project_id !== projectId) return;

    const content = b64ToContent(msg.content, isBinaryPath(msg.path));
    const existing = await fileStorageService.getFileByPath(msg.path);

    if (existing) {
      // Skip if our local copy is newer (user is actively editing)
      if (existing.lastModified > Date.now() - 2000) return;
      await fileStorageService.updateFileContent(existing.id, content, {
        showConflictDialog: false,
        preserveTimestamp: true,
      });
    } else {
      const name = msg.path.split('/').pop() ?? msg.path;
      await fileStorageService.storeFile(
        {
          id: `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name,
          path: msg.path,
          type: 'file',
          content,
          lastModified: Date.now(),
          isBinary: isBinaryPath(msg.path),
        },
        { showConflictDialog: false },
      );
    }
  }, []);

  const onFileDeleted = useCallback(async (msg: WsFileDeleted) => {
    const projectId = fileStorageService.getCurrentProjectId();
    if (msg.project_id !== projectId) return;

    const existing = await fileStorageService.getFileByPath(msg.path);
    if (existing) {
      await fileStorageService.deleteFile(existing.id, { showDeleteDialog: false });
    }
  }, []);

  // ── Handle initial file listing on subscribe ───────────────────────

  const onSubscribed = useCallback(async (msg: WsSubscribed) => {
    const projectId = fileStorageService.getCurrentProjectId();
    if (msg.project_id !== projectId) return;

    // For each file the server reports: pull it if server copy is newer
    const enc = new TextEncoder();
    for (const serverFile of msg.files as SyncFileMeta[]) {
      const local = await fileStorageService.getFileByPath(serverFile.path);
      const serverMs = serverFile.modified * 1000;

      if (!local || (local.lastModified < serverMs - 1000)) {
        // Pull from server
        try {
          const bytes = await syncServerService.getFile(projectId, serverFile.path);
          const content = isBinaryPath(serverFile.path)
            ? bytes.buffer as ArrayBuffer
            : new TextDecoder().decode(bytes);

          if (local) {
            await fileStorageService.updateFileContent(local.id, content, {
              showConflictDialog: false,
              preserveTimestamp: true,
            });
          } else {
            const name = serverFile.path.split('/').pop() ?? serverFile.path;
            await fileStorageService.storeFile(
              {
                id: `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name,
                path: serverFile.path,
                type: 'file',
                content,
                lastModified: serverMs,
                isBinary: isBinaryPath(serverFile.path),
              },
              { showConflictDialog: false },
            );
          }
        } catch (e) {
          console.warn('[SyncServer] pull failed:', serverFile.path, e);
        }
      } else if (local && local.lastModified > serverMs + 1000) {
        // Push our newer local copy to server
        try {
          const bytes =
            typeof local.content === 'string'
              ? enc.encode(local.content)
              : new Uint8Array(local.content as ArrayBuffer);
          await syncServerService.putFile(projectId, serverFile.path, bytes);
        } catch (e) {
          console.warn('[SyncServer] push failed:', serverFile.path, e);
        }
      }
    }
  }, []);

  // ── Send local file changes to server ─────────────────────────────

  useEffect(() => {
    const handler = async (e: Event) => {
      if (!isEnabled() || !syncConnection.isOpen()) return;
      const { fileId, path, projectId } = (e as FileStoredEvent).detail;
      if (!projectId) return;

      const file = await fileStorageService.getFile(fileId);
      if (!file || file.type !== 'file') return;

      syncConnection.sendFileWrite(projectId, path, file.content ?? '');
    };

    window.addEventListener('texlyre:file-stored', handler);
    return () => window.removeEventListener('texlyre:file-stored', handler);
  }, []);

  // ── Connection lifecycle ──────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled()) {
      setSyncStatus('disabled');
      syncConnection.disconnect();
      return;
    }

    const url = getUrl();
    syncServerService.configure(url);
    setSyncStatus('connecting');

    const onConnected = () => {
      setSyncStatus('connected');
      if (activeProjectRef.current) {
        syncConnection.subscribe(activeProjectRef.current);
      }
    };
    const onDisconnected = () => setSyncStatus('error');
    const onError = (_msg: string) => setSyncStatus('error');

    syncConnection.on('connected', onConnected);
    syncConnection.on('disconnected', onDisconnected);
    syncConnection.on('file_changed', onFileChanged);
    syncConnection.on('file_deleted', onFileDeleted);
    syncConnection.on('subscribed', onSubscribed);
    syncConnection.on('error', onError);

    syncConnection.connect(url.replace(/\/$/, '').replace(/^http/, 'ws') + '/ws');

    return () => {
      syncConnection.off('connected', onConnected);
      syncConnection.off('disconnected', onDisconnected);
      syncConnection.off('file_changed', onFileChanged);
      syncConnection.off('file_deleted', onFileDeleted);
      syncConnection.off('subscribed', onSubscribed);
      syncConnection.off('error', onError);
    };
  }, [
    getSetting('sync-server-enabled')?.value,
    getSetting('sync-server-url')?.value,
  ]);

  // ── Subscribe when project changes ───────────────────────────────

  const subscribeToProject = useCallback((projectId: string) => {
    activeProjectRef.current = projectId;
    if (syncConnection.isOpen()) {
      syncConnection.subscribe(projectId);
    }
  }, []);

  const unsubscribeFromProject = useCallback((projectId: string) => {
    if (activeProjectRef.current === projectId) activeProjectRef.current = null;
    if (syncConnection.isOpen()) {
      syncConnection.unsubscribe(projectId);
    }
  }, []);

  return { syncStatus, subscribeToProject, unsubscribeFromProject };
}
