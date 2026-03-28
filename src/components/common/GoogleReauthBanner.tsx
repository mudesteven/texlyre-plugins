// src/components/common/GoogleReauthBanner.tsx
import { t } from '@/i18n';
import type React from 'react';
import { useState } from 'react';

import { useAuth } from '../../hooks/useAuth';

const DISMISS_KEY = 'texlyre-google-reauth-dismissed';

const GoogleReauthBanner: React.FC = () => {
	const { googleStatus, signInWithGoogle } = useAuth();
	const [dismissed, setDismissed] = useState(
		() => sessionStorage.getItem(DISMISS_KEY) === '1',
	);
	const [isReconnecting, setIsReconnecting] = useState(false);

	if (googleStatus !== 'needs_reauth' || dismissed) return null;

	const handleReconnect = async () => {
		setIsReconnecting(true);
		try {
			const result = await signInWithGoogle();
			if (result.success) {
				setDismissed(true);
			}
		} finally {
			setIsReconnecting(false);
		}
	};

	const handleDismiss = () => {
		sessionStorage.setItem(DISMISS_KEY, '1');
		setDismissed(true);
	};

	return (
		<div className="google-reauth-banner" role="alert">
			<span className="reauth-banner-text">
				{t('Google session expired — your Drive sync is paused.')}
			</span>
			<button
				type="button"
				className="reauth-banner-btn"
				onClick={handleReconnect}
				disabled={isReconnecting}
			>
				{isReconnecting ? t('Reconnecting...') : t('Re-connect')}
			</button>
			<button
				type="button"
				className="reauth-banner-dismiss"
				onClick={handleDismiss}
				aria-label={t('Dismiss')}
			>
				✕
			</button>
		</div>
	);
};

export default GoogleReauthBanner;
