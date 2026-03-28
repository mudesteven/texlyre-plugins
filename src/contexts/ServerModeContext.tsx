// src/contexts/ServerModeContext.tsx
// Detects whether the app is running behind the sync-server Vite plugin.
// Provides isServerMode + syncProjectFiles to the rest of the app.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { serverSyncService } from '../services/ServerSyncService';
import { useServerSync } from '../hooks/useServerSync';

interface ServerModeContextType {
  isServerMode: boolean;
  /** Call this when a project is opened to do an initial LWW sync. */
  syncProjectFiles: (projectId: string) => Promise<void>;
  /** Re-push account + projects to server (call after login / project change). */
  pushAccount: () => Promise<void>;
}

const ServerModeContext = createContext<ServerModeContextType>({
  isServerMode: false,
  syncProjectFiles: async () => {},
  pushAccount: async () => {},
});

export function ServerModeProvider({ children }: { children: ReactNode }) {
  const [isServerMode, setIsServerMode] = useState(false);

  useEffect(() => {
    serverSyncService.ping().then(setIsServerMode);
  }, []);

  const { syncProjectFiles, pushAccount } = useServerSync(isServerMode);

  return (
    <ServerModeContext.Provider value={{ isServerMode, syncProjectFiles, pushAccount }}>
      {children}
    </ServerModeContext.Provider>
  );
}

export function useServerMode() {
  return useContext(ServerModeContext);
}
