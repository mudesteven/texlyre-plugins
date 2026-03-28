// src/components/auth/Login.tsx
import { t } from '@/i18n';
import type React from 'react';
import { useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useServerMode } from '../../contexts/ServerModeContext';
import { serverSyncService } from '../../services/ServerSyncService';
import { authService } from '../../services/AuthService';
import GuestConsentModal from './GuestConsentModal';
import PrivacyModal from '../common/PrivacyModal';

interface LoginProps {
  onLoginSuccess: () => void;
  onSwitchToRegister: () => void;
  onSwitchToImport: () => void;
}

const Login: React.FC<LoginProps> = ({
  onLoginSuccess,
  onSwitchToRegister,
  onSwitchToImport
}) => {
  const { login, createGuestAccount } = useAuth();
  const { currentThemePlugin } = useTheme();
  const { isServerMode, pushAccount } = useServerMode();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !password) {
      setError(t('Please enter both username and password'));
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      await login(username, password);
      onLoginSuccess();
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('An error occurred during login')
      );
    } finally {
      setIsLoading(false);
    }
  };

  /** Sign in using account stored on the sync server. */
  const handleServerSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !password) {
      setError(t('Please enter both username and password'));
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      // Fetch account from server
      const serverUser = await serverSyncService.getAccount();
      if (!serverUser) throw new Error(t('No account found on server'));

      if (serverUser.username !== username) {
        throw new Error(t('Username does not match server account'));
      }

      // Verify password locally against the stored hash
      const ok = await authService.verifyPasswordHash(password, serverUser.passwordHash);
      if (!ok) throw new Error(t('Invalid password'));

      // Pull projects from server
      const serverProjects = await serverSyncService.getProjects();

      // Seed local IndexedDB and log in
      await authService.importServerAccount(serverUser, serverProjects);

      // Push the account back so server stays in sync
      await pushAccount();

      onLoginSuccess();
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('An error occurred during server sign in')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleShowPrivacy = () => setShowPrivacy(true);
  const handleClosePrivacy = () => setShowPrivacy(false);

  const handleGuestSession = async () => {
    setError(null);
    setIsLoading(true);

    try {
      console.log('[Login] Starting guest session creation...');
      const guestUser = await createGuestAccount();
      console.log('[Login] Guest session created successfully:', guestUser.id);
      setShowGuestModal(false);
      onLoginSuccess();
    } catch (err) {
      console.error('[Login] Guest session creation failed:', err);
      setError(
        err instanceof Error ? err.message : t('Failed to create guest session')
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="auth-form-container">
        <h2>{t('Login')}</h2>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="username">{t('Username')}</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              autoComplete="username" />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t('Password')}</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="current-password" />
          </div>

          <button
            type="submit"
            className={`auth-button ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}>
            {isLoading ? t('Logging in...') : t('Login')}
          </button>
        </form>

        {isServerMode && (
          <div className="guest-section">
            <div className="guest-divider">
              <span>{t('or')}</span>
            </div>
            <button
              type="button"
              className="auth-button"
              onClick={handleServerSignIn}
              disabled={isLoading}>
              {isLoading ? t('Signing in...') : t('Sign in from server')}
            </button>
            <p className="auth-hint">{t('Imports your account and projects from the sync server.')}</p>
          </div>
        )}

        <div className="guest-section">
          <div className="guest-divider">
            <span>{t('or')}</span>
          </div>
          <button
            type="button"
            className="auth-button guest-button"
            onClick={() => setShowGuestModal(true)}
            disabled={isLoading}>{t('Try as Guest')}
          </button>
        </div>

        <div className="auth-alt-action">
          <span>{t('Don\'t have an account?')}</span>
          <button
            className="text-button"
            onClick={onSwitchToRegister}
            disabled={isLoading}>{t('Sign up')}
          </button>
          <span className="auth-separator">{t('or')}</span>
          <button
            className="text-button"
            onClick={onSwitchToImport}
            disabled={isLoading}>{t('Import Account')}
          </button>
        </div>
      </div>

      <GuestConsentModal
        isOpen={showGuestModal}
        onClose={() => setShowGuestModal(false)}
        onStartGuestSession={handleGuestSession}
        onSwitchToRegister={() => {
          setShowGuestModal(false);
          onSwitchToRegister();
        }}
        onShowPrivacy={handleShowPrivacy}
        isPrivacyOpen={showPrivacy} />

      <PrivacyModal
        isOpen={showPrivacy}
        onClose={handleClosePrivacy} />
    </>
  );
};

export default Login;
