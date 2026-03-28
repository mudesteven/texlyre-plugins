// src/components/profile/UserDropdown.tsx
import { t } from '@/i18n';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { UserIcon, UpgradeAccountIcon, TrashIcon, ExportIcon, EditIcon, LogoutIcon } from '../common/Icons';

interface UserDropdownProps {
  username: string;
  onLogout: () => void;
  onOpenProfile: () => void;
  onOpenExport: () => void;
  onOpenDeleteAccount: () => void;
  onOpenUpgrade?: () => void;
  isGuest?: boolean;
  googlePicture?: string;
}

const UserDropdown: React.FC<UserDropdownProps> = ({
  username,
  onLogout,
  onOpenProfile,
  onOpenExport,
  onOpenDeleteAccount,
  onOpenUpgrade,
  isGuest = false,
  googlePicture,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const getMenuPos = () => {
    if (!btnRef.current) return { top: 48, right: 8 };
    const rect = btnRef.current.getBoundingClientRect();
    return { top: rect.bottom + 4, right: window.innerWidth - rect.right };
  };

  const displayUsername = isGuest ? t('Guest User') : username;
  const menuPos = getMenuPos();

  return (
    <div className="user-dropdown-container">
      <button
        ref={btnRef}
        className={`user-dropdown-button ${isGuest ? 'guest' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true">

        {googlePicture ? (
          <img
            src={googlePicture}
            alt={displayUsername}
            className="user-dropdown-avatar"
            referrerPolicy="no-referrer"
          />
        ) : (
          <UserIcon />
        )}
        <span>{displayUsername}</span>
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="user-dropdown-menu"
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
        >
          {!isGuest &&
            <>
              <button
                className="dropdown-item"
                onClick={() => {
                  setIsOpen(false);
                  onOpenProfile();
                }}>

                <EditIcon />{t('Profile Settings')}

              </button>
              <button
                className="dropdown-item"
                onClick={() => {
                  setIsOpen(false);
                  onOpenExport();
                }}>

                <ExportIcon />{t('Export Account')}

              </button>
              <div className="dropdown-separator" />
              <button
                className="dropdown-item danger"
                onClick={() => {
                  setIsOpen(false);
                  onOpenDeleteAccount();
                }}>

                <TrashIcon />{t('Delete Account')}

              </button>
            </>
          }
          {isGuest && onOpenUpgrade &&
            <>
              <button
                className="dropdown-item"
                onClick={() => {
                  setIsOpen(false);
                  onOpenUpgrade();
                }}>

                <UpgradeAccountIcon />{t('Upgrade Account')}

              </button>
              <div className="dropdown-separator" />
            </>
          }
          <button
            className="dropdown-item"
            onClick={() => {
              setIsOpen(false);
              onLogout();
            }}>

            {isGuest ?
              <>
                <TrashIcon />
                <span>{t('End Session')}</span>
              </> :

              <>
                <LogoutIcon />
                <span>{t('Logout')}</span>
              </>
            }
          </button>
        </div>,
        document.body
      )}
    </div>);

};

export default UserDropdown;