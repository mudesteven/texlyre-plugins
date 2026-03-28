// src/components/settings/SyncServerControls.tsx
// Rendered inline inside Settings → Sync → Server via setting description.

import { useEffect, useState } from 'react';
import { syncServerService } from '../../services/SyncServerService';
import { fileStorageService } from '../../services/FileStorageService';
import { authService } from '../../services/AuthService';
import type { SyncFileMeta } from '../../types/sync';
import { useSyncServerContext } from '../../contexts/SyncServerContext';
import { useSettings } from '../../hooks/useSettings';

export function SyncServerControls() {
  const { syncStatus } = useSyncServerContext();
  const { getSetting } = useSettings();
  const serverUrl = (getSetting('sync-server-url')?.value as string) ?? 'http://localhost:7331';

  const [error, setError]           = useState('');
  const [progress, setProgress]     = useState<string | null>(null);

  useEffect(() => {
    syncServerService.configure(serverUrl);
  }, [serverUrl]);

  /** Bidirectional LWW sync for the current project. */
  const handleSyncNow = async () => {
    const projectId = fileStorageService.getCurrentProjectId();
    if (!projectId) { setError('No project open'); return; }
    setProgress('Comparing files…');
    const enc = new TextEncoder();
    try {
      try { await syncServerService.getProject(projectId); }
      catch {
        const project = await authService.getProjectById(projectId);
        await syncServerService.createProject({ title: project?.name ?? 'Untitled', type: project?.type ?? 'typst', tags: project?.tags ?? [] });
      }

      const [localFiles, serverFiles] = await Promise.all([
        fileStorageService.getAllFiles(),
        syncServerService.listFiles(projectId).catch((): SyncFileMeta[] => []),
      ]);

      const serverMap = new Map(serverFiles.map(f => [f.path, f]));
      const localMap  = new Map(localFiles.filter(f => f.type === 'file' && !f.isDeleted).map(f => [f.path, f]));

      let pushed = 0, pulled = 0, done = 0;
      const total = new Set([...serverMap.keys(), ...localMap.keys()]).size;

      for (const [p, local] of localMap) {
        const server  = serverMap.get(p);
        const serverMs = server ? server.modified * 1000 : 0;
        if (!server || local.lastModified > serverMs + 1000) {
          const bytes = typeof local.content === 'string' ? enc.encode(local.content) : new Uint8Array(local.content as ArrayBuffer);
          await syncServerService.putFile(projectId, p, bytes);
          pushed++;
        }
        done++;
        setProgress(`Syncing ${done}/${total}…`);
      }

      for (const [p, sf] of serverMap) {
        if (localMap.has(p)) continue;
        const bytes   = await syncServerService.getFile(projectId, p);
        const isBin   = /\.(pdf|png|jpg|jpeg|gif|svg|zip|woff2?)$/.test(p);
        const content = isBin ? (bytes.buffer as ArrayBuffer) : new TextDecoder().decode(bytes);
        const fname   = p.split('/').pop() ?? p;
        await fileStorageService.storeFile(
          { id: `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: fname, path: p, type: 'file', content, lastModified: sf.modified * 1000, isBinary: isBin },
          { showConflictDialog: false },
        );
        pulled++; done++;
        setProgress(`Syncing ${done}/${total}…`);
      }

      setProgress(`Done — ↑${pushed} pushed, ↓${pulled} pulled`);
      setTimeout(() => setProgress(null), 4000);
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const statusDot: Record<typeof syncStatus, string> = {
    disabled: '#888', connecting: '#f59e0b', connected: '#22c55e', error: '#ef4444',
  };
  const statusLabel: Record<typeof syncStatus, string> = {
    disabled: 'Disabled', connecting: 'Connecting…', connected: 'Connected', error: 'Connection error',
  };

  return (
    <div className="sync-inline-controls">
      <div className="sync-inline-status">
        <span className="sync-inline-dot" style={{ background: statusDot[syncStatus] }} />
        <span className="sync-inline-status-text">{statusLabel[syncStatus]}</span>
      </div>

      {syncStatus === 'connected' && (
        <div className="sync-inline-actions">
          <button type="button" className="sync-btn sync-btn-primary" onClick={handleSyncNow} disabled={!!progress}>
            ⇅ Sync now
          </button>
          {progress && <p className="sync-progress">{progress}</p>}
          {error    && <p className="sync-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
