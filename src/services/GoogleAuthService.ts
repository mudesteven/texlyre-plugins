// src/services/GoogleAuthService.ts
import { authService } from './AuthService';
import type { GoogleProfile, GoogleToken } from '../types/auth';

// GIS type stubs (avoids a separate @types/google package)
declare global {
	interface Window {
		google?: {
			accounts: {
				oauth2: {
					initTokenClient: (config: GisTokenClientConfig) => GisTokenClient;
					revoke: (token: string, callback?: () => void) => void;
				};
			};
		};
	}
}

interface GisTokenClientConfig {
	client_id: string;
	scope: string;
	prompt?: string;
	callback: (response: GisTokenResponse) => void;
	error_callback?: (error: GisTokenError) => void;
}

interface GisTokenClient {
	requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GisTokenResponse {
	access_token: string;
	expires_in: number;
	scope: string;
	token_type: string;
	error?: string;
}

interface GisTokenError {
	type: string;
	message?: string;
}

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ALL_SCOPES = `openid email profile ${DRIVE_SCOPE}`;

class GoogleAuthService {
	private clientId = '';
	private scriptLoading: Promise<void> | null = null;
	private scriptLoaded = false;

	configure(clientId: string): void {
		this.clientId = clientId;
	}

	getClientId(): string {
		return this.clientId;
	}

	private loadGisScript(): Promise<void> {
		if (this.scriptLoaded) return Promise.resolve();
		if (this.scriptLoading) return this.scriptLoading;

		this.scriptLoading = new Promise((resolve, reject) => {
			if (document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`)) {
				this.scriptLoaded = true;
				resolve();
				return;
			}
			const script = document.createElement('script');
			script.src = GIS_SCRIPT_URL;
			script.async = true;
			script.defer = true;
			script.onload = () => {
				this.scriptLoaded = true;
				resolve();
			};
			script.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
			document.head.appendChild(script);
		});

		return this.scriptLoading;
	}

	private async fetchProfile(accessToken: string): Promise<GoogleProfile> {
		const res = await fetch(USERINFO_URL, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!res.ok) throw new Error(`Failed to fetch Google profile: ${res.status}`);
		const data = await res.json();
		return {
			sub: data.sub,
			email: data.email,
			name: data.name,
			picture: data.picture,
		};
	}

	private requestToken(prompt: string): Promise<GisTokenResponse> {
		return new Promise((resolve, reject) => {
			if (!window.google?.accounts?.oauth2) {
				reject(new Error('Google Identity Services not loaded'));
				return;
			}
			const client = window.google.accounts.oauth2.initTokenClient({
				client_id: this.clientId,
				scope: ALL_SCOPES,
				prompt,
				callback: (response) => {
					if (response.error) {
						reject(new Error(response.error));
					} else {
						resolve(response);
					}
				},
				error_callback: (error) => {
					reject(new Error(error.message ?? error.type));
				},
			});
			client.requestAccessToken({ prompt });
		});
	}

	/**
	 * Interactive sign-in — shows Google account chooser popup.
	 * Returns profile + raw token response on success, null if user cancels.
	 */
	async signIn(): Promise<{ profile: GoogleProfile; accessToken: string; tokenResponse: GisTokenResponse } | null> {
		if (!this.clientId) throw new Error('Google client ID not configured');
		await this.loadGisScript();

		try {
			const tokenResponse = await this.requestToken('select_account');
			const profile = await this.fetchProfile(tokenResponse.access_token);
			return { profile, accessToken: tokenResponse.access_token, tokenResponse };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			// User closed the popup or access_denied is not an error we should surface as throw
			if (msg.includes('popup_closed') || msg.includes('access_denied')) {
				return null;
			}
			throw err;
		}
	}

	/**
	 * Silent token refresh — uses existing Google browser session without showing UI.
	 * Returns new access token, or null if re-auth is needed.
	 */
	async refreshToken(userId: string): Promise<string | null> {
		if (!this.clientId) return null;
		try {
			await this.loadGisScript();
			const tokenResponse = await this.requestToken('');
			const newToken: GoogleToken = {
				userId,
				accessToken: tokenResponse.access_token,
				expiresAt: Date.now() + 55 * 60 * 1000,
				scopes: tokenResponse.scope.split(' '),
			};
			await authService.storeGoogleToken(newToken);
			return tokenResponse.access_token;
		} catch {
			return null;
		}
	}

	/**
	 * Returns a valid access token for the user.
	 * Reads from storage if not expired, attempts silent refresh if near expiry.
	 * Returns null if the user needs to re-authenticate interactively.
	 */
	async getValidToken(userId: string): Promise<string | null> {
		const stored = await authService.getGoogleToken(userId);
		if (!stored) return null;

		// If token is still valid with >2 min buffer, return it
		if (stored.expiresAt > Date.now() + 2 * 60 * 1000) {
			return stored.accessToken;
		}

		// Token is expired or close to expiry — try silent refresh
		return this.refreshToken(userId);
	}

	/**
	 * Revokes the token at Google and removes it from local storage.
	 */
	async revokeToken(userId: string): Promise<void> {
		const stored = await authService.getGoogleToken(userId);
		if (stored?.accessToken && window.google?.accounts?.oauth2) {
			window.google.accounts.oauth2.revoke(stored.accessToken);
		}
		await authService.deleteGoogleToken(userId);
	}
}

export const googleAuthService = new GoogleAuthService();
