// src/components/common/SyncStatusIndicator.tsx
import type { SyncStatus } from '../../types/sync';

interface Props {
  status: SyncStatus;
  onClick?: () => void;
}

export function SyncStatusIndicator({ status, onClick }: Props) {
  if (status === 'disabled') return null;

  const dotColor =
    status === 'connected' ? 'var(--sync-dot-connected)' :
    status === 'connecting' ? 'var(--sync-dot-connecting)' :
    'var(--sync-dot-error)';

  const label =
    status === 'connected' ? 'Sync connected' :
    status === 'connecting' ? 'Sync connecting…' :
    'Sync error — click to reconnect';

  return (
    <button
      type="button"
      className="sync-status-indicator"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {/* Cloud icon */}
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
        <path
          d="M14.5 5.5A4 4 0 0 0 7.1 3.6 3 3 0 0 0 4 6.5a3 3 0 0 0 0 6h10a2.5 2.5 0 0 0 .5-5Z"
          fill="currentColor"
          opacity="0.7"
        />
      </svg>
      <span className="sync-status-dot" style={{ background: dotColor }} />
    </button>
  );
}
