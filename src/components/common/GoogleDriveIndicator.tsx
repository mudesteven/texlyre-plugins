// src/components/common/GoogleDriveIndicator.tsx
import type React from 'react';
import { useAuth } from '../../hooks/useAuth';

interface GoogleDriveIndicatorProps {
  className?: string;
  onOpenProfile?: () => void;
}

const GoogleDriveIndicator: React.FC<GoogleDriveIndicatorProps> = ({ className = '', onOpenProfile }) => {
  const { googleStatus, user } = useAuth();

  if (!user?.googleId) return null;

  const statusColor =
    googleStatus === 'connected' ? '#28a745' :
    googleStatus === 'needs_reauth' ? '#ffc107' :
    '#6c757d';

  const statusLabel =
    googleStatus === 'connected' ? 'Drive connected' :
    googleStatus === 'needs_reauth' ? 'Drive: session expired' :
    'Drive disconnected';

  return (
    <button
      type="button"
      className={`google-drive-indicator ${className}`}
      title={statusLabel}
      onClick={onOpenProfile}
    >
      {/* Google Drive icon (simplified) */}
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="drive-icon">
        <path fill="#0066da" d="M6.28 5l7.72 13.35L1.6 5z" />
        <path fill="#00ac47" d="M22.4 18.35L15.64 5H8.36l6.76 13.35z" />
        <path fill="#ea4335" d="M1.6 18.35h20.8l-3.56-6.18H5.16z" />
      </svg>
      <span
        className="drive-status-dot"
        style={{ backgroundColor: statusColor }}
        aria-label={statusLabel}
      />
    </button>
  );
};

export default GoogleDriveIndicator;
