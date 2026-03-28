// src/components/settings/SyncServerPanel.tsx
// Panel for sync server connection status and project sync actions.

import { useState } from 'react';
import { syncServerService } from '../../services/SyncServerService';
import { fileStorageService } from '../../services/FileStorageService';
import { authService } from '../../services/AuthService';
import type { SyncStatus } from '../../types/sync';
import Modal from '../common/Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  syncStatus: SyncStatus;
  serverUrl: string;
}

export function SyncServerPanel({ isOpen, onClose, syncStatus, serverUrl }: Props) {
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  /** Upload every file in the current project to the sync server. */
  const handleUploadProject = async () => {
    const projectId = fileStorageService.getCurrentProjectId();
    if (!projectId) return;
    setUploadProgress('Reading files…');
    try {
      const files = await fileStorageService.getAllFiles();
      const toUpload = files.filter(
        (f) => f.type === 'file' && !f.isDeleted && f.content !== undefined,
      );

      try {
        await syncServerService.getProject(projectId);
      } catch {
        const project = await authService.getProjectById(projectId);
        await syncServerService.createProject({
          title: project?.name ?? 'Untitled',
          type: project?.type ?? 'typst',
          tags: project?.tags ?? [],
        });
      }

      await syncServerService.uploadProjectFiles(
        projectId,
        toUpload.map((f) => ({ path: f.path, content: f.content! })),
        (done, total) => setUploadProgress(`Uploading ${done}/${total}…`),
      );
      setUploadProgress(`Done — ${toUpload.length} files uploaded`);
      setTimeout(() => setUploadProgress(null), 3000);
    } catch (err) {
      setUploadProgress(null);
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  /** Pull all files from the server for the current project. */
  const handlePullProject = async () => {
    const projectId = fileStorageService.getCurrentProjectId();
    if (!projectId) return;
    setUploadProgress('Pulling from server…');
    try {
      const serverFiles = await syncServerService.listFiles(projectId);
      let done = 0;
      for (const sf of serverFiles) {
        const bytes = await syncServerService.getFile(projectId, sf.path);
        const isBin = /\.(pdf|png|jpg|jpeg|gif|svg|zip|woff2?)$/.test(sf.path);
        const content = isBin
          ? (bytes.buffer as ArrayBuffer)
          : new TextDecoder().decode(bytes);

        const existing = await fileStorageService.getFileByPath(sf.path);
        if (existing) {
          await fileStorageService.updateFileContent(existing.id, content, {
            showConflictDialog: false,
            preserveTimestamp: true,
          });
        } else {
          const fileName = sf.path.split('/').pop() ?? sf.path;
          await fileStorageService.storeFile(
            {
              id: `pull-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: fileName,
              path: sf.path,
              type: 'file',
              content,
              lastModified: sf.modified * 1000,
              isBinary: isBin,
            },
            { showConflictDialog: false },
          );
        }
        done++;
        setUploadProgress(`Pulled ${done}/${serverFiles.length}…`);
      }
      setUploadProgress(`Done — ${serverFiles.length} files pulled`);
      setTimeout(() => setUploadProgress(null), 3000);
    } catch (err) {
      setUploadProgress(null);
      setError(err instanceof Error ? err.message : 'Pull failed');
    }
  };

  /** Bidirectional sync for the current project: LWW per file. */
  const handleSyncNow = async () => {
    const projectId = fileStorageService.getCurrentProjectId();
    if (!projectId) return;
    setUploadProgress('Comparing files…');
    const enc = new TextEncoder();
    try {
      try {
        await syncServerService.getProject(projectId);
      } catch {
        const project = await authService.getProjectById(projectId);
        await syncServerService.createProject({
          title: project?.name ?? 'Untitled',
          type: project?.type ?? 'typst',
          tags: project?.tags ?? [],
        });
      }

      const [localFiles, serverFiles] = await Promise.all([
        fileStorageService.getAllFiles(),
        syncServerService.listFiles(projectId).catch((): import('../../types/sync').SyncFileMeta[] => []),
      ]);

      const serverMap = new Map(serverFiles.map((f) => [f.path, f]));
      const localMap  = new Map(
        localFiles
          .filter((f) => f.type === 'file' && !f.isDeleted)
          .map((f) => [f.path, f]),
      );

      let pushed = 0, pulled = 0;
      const total = new Set([...serverMap.keys(), ...localMap.keys()]).size;
      let done = 0;

      for (const [p, local] of localMap) {
        const server = serverMap.get(p);
        const serverMs = server ? server.modified * 1000 : 0;
        if (!server || local.lastModified > serverMs + 1000) {
          const bytes = typeof local.content === 'string'
            ? enc.encode(local.content)
            : new Uint8Array(local.content as ArrayBuffer);
          await syncServerService.putFile(projectId, p, bytes);
          pushed++;
        }
        done++;
        setUploadProgress(`Syncing ${done}/${total}…`);
      }

      for (const [p, sf] of serverMap) {
        if (localMap.has(p)) continue;
        const bytes = await syncServerService.getFile(projectId, p);
        const isBin = /\.(pdf|png|jpg|jpeg|gif|svg|zip|woff2?)$/.test(p);
        const content = isBin ? (bytes.buffer as ArrayBuffer) : new TextDecoder().decode(bytes);
        const name = p.split('/').pop() ?? p;
        await fileStorageService.storeFile(
          { id: `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, path: p, type: 'file', content, lastModified: sf.modified * 1000, isBinary: isBin },
          { showConflictDialog: false },
        );
        pulled++;
        done++;
        setUploadProgress(`Syncing ${done}/${total}…`);
      }

      setUploadProgress(`Done — ↑${pushed} pushed, ↓${pulled} pulled`);
      setTimeout(() => setUploadProgress(null), 4000);
    } catch (err) {
      setUploadProgress(null);
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const statusLabel: Record<SyncStatus, string> = {
    disabled: 'Disabled',
    connecting: 'Connecting…',
    connected: 'Connected',
    error: 'Disconnected',
  };

  const statusClass: Record<SyncStatus, string> = {
    disabled: 'sync-status-badge sync-disabled',
    connecting: 'sync-status-badge sync-connecting',
    connected: 'sync-status-badge sync-connected',
    error: 'sync-status-badge sync-error',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sync Server">
      <div className="sync-panel">

        <div className="sync-panel-row">
          <span className="sync-panel-label">Status</span>
          <span className={statusClass[syncStatus]}>{statusLabel[syncStatus]}</span>
        </div>
        <div className="sync-panel-row">
          <span className="sync-panel-label">Server</span>
          <code className="sync-panel-url">{serverUrl}</code>
        </div>

        {syncStatus === 'connected' ? (
          <div className="sync-panel-actions">
            <button
              type="button"
              className="sync-btn sync-btn-primary"
              onClick={handleSyncNow}
              disabled={!!uploadProgress}
            >
              ⇅ Sync now (bidirectional)
            </button>
            <button
              type="button"
              className="sync-btn sync-btn-secondary"
              onClick={handleUploadProject}
              disabled={!!uploadProgress}
            >
              ↑ Push all local → server
            </button>
            <button
              type="button"
              className="sync-btn sync-btn-secondary"
              onClick={handlePullProject}
              disabled={!!uploadProgress}
            >
              ↓ Pull all server → local
            </button>
          </div>
        ) : (
          <p className="sync-progress">
            {syncStatus === 'disabled'
              ? 'Enable sync in Settings → Sync → Server.'
              : syncStatus === 'connecting'
              ? 'Connecting to server…'
              : 'Connection error — check server URL.'}
          </p>
        )}

        {uploadProgress && <p className="sync-progress">{uploadProgress}</p>}
        {error && <p className="sync-error">{error}</p>}

      </div>
    </Modal>
  );
}
