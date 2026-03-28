// src/contexts/SyncServerContext.tsx
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { useSyncServer } from '../hooks/useSyncServer';
import type { SyncStatus } from '../types/sync';

interface SyncServerContextType {
  syncStatus: SyncStatus;
  subscribeToProject: (projectId: string) => void;
  unsubscribeFromProject: (projectId: string) => void;
}

const SyncServerContext = createContext<SyncServerContextType>({
  syncStatus: 'disabled',
  subscribeToProject: () => {},
  unsubscribeFromProject: () => {},
});

export function SyncServerProvider({ children }: { children: ReactNode }) {
  const sync = useSyncServer();
  return (
    <SyncServerContext.Provider value={sync}>
      {children}
    </SyncServerContext.Provider>
  );
}

export function useSyncServerContext() {
  return useContext(SyncServerContext);
}
