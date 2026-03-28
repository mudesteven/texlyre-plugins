// src/components/auth/Login.tsx
import { t } from '@/i18n';
import type React from 'react';
import { useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
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
  const { login, createGuestAccount, signInWithGoogle } = useAuth();
  const { currentThemePlugin } = useTheme();

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

  const handleShowPrivacy = () => {
    setShowPrivacy(true);
  };

  const handleClosePrivacy = () => {
    setShowPrivacy(false);
    // Don't close the guest modal when privacy modal closes
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result.success) {
        onLoginSuccess();
        window.location.reload();
      } else if (result.error && result.error !== 'Sign-in cancelled') {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Google sign-in failed'));
    } finally {
      setIsLoading(false);
    }
  };

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

        <div className="guest-section">
          <div className="guest-divider">
            <span>{t('or')}</span>
          </div>
          <button
            type="button"
            className="auth-button google-button"
            onClick={handleGoogleSignIn}
            disabled={isLoading}>
            <svg className="google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {isLoading ? t('Signing in...') : t('Sign in with Google')}
          </button>
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

    </>);

};

export default Login;