// src/components/common/NotificationCenter.tsx
import { t } from '@/i18n';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellIcon } from './Icons';

export interface Notification {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  timestamp?: number;
}

interface NotificationCenterProps {
  notifications: Notification[];
  onClear: (id: string) => void;
  onClearAll: () => void;
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  onClear,
  onClearAll,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const count = notifications.length;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const getDropdownPos = () => {
    if (!btnRef.current) return { top: 48, right: 8 };
    const rect = btnRef.current.getBoundingClientRect();
    return { top: rect.bottom + 4, right: window.innerWidth - rect.right };
  };

  const pos = getDropdownPos();

  return (
    <>
      <button
        ref={btnRef}
        className="notification-btn"
        onClick={() => setIsOpen((v) => !v)}
        title={t('Notifications')}
      >
        <BellIcon />
        {count > 0 && (
          <span className="notification-badge">{count > 9 ? '9+' : count}</span>
        )}
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="notification-dropdown"
          style={{ top: pos.top, right: pos.right }}
        >
          <div className="notification-dropdown-header">
            <span>{t('Notifications')}</span>
            {count > 0 && (
              <button className="notif-clear-all" onClick={() => { onClearAll(); setIsOpen(false); }}>
                {t('Clear all')}
              </button>
            )}
          </div>
          {count === 0 ? (
            <div className="notification-empty">{t('No new notifications')}</div>
          ) : (
            <div className="notification-list">
              {notifications.map((n) => (
                <div key={n.id} className={`notification-item notif-${n.type || 'info'}`}>
                  <span className="notif-message">{n.message}</span>
                  <button className="notif-dismiss" onClick={() => onClear(n.id)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
};

export default NotificationCenter;
