// src/contexts/AuthContext.tsx
import type React from 'react';
import { type ReactNode, createContext, useCallback, useEffect, useState } from 'react';

import { authService } from '../services/AuthService';
import { googleAuthService } from '../services/GoogleAuthService';
import type { AuthContextType, User } from '../types/auth';
import type { Project } from '../types/projects';
import { useSettings } from '../hooks/useSettings';

export const AuthContext = createContext<AuthContextType>({
	user: null,
	isAuthenticated: false,
	isInitializing: true,
	googleStatus: 'disconnected',
	login: async () => {
		throw new Error('Not implemented');
	},
	register: async () => {
		throw new Error('Not implemented');
	},
	createGuestAccount: async () => {
		throw new Error('Not implemented');
	},
	upgradeGuestAccount: async () => {
		throw new Error('Not implemented');
	},
	logout: async () => {
		throw new Error('Not implemented');
	},
	updateUser: async () => {
		throw new Error('Not implemented');
	},
	updateUserColor: async () => {
		throw new Error('Not implemented');
	},
	createProject: async () => {
		throw new Error('Not implemented');
	},
	updateProject: async () => {
		throw new Error('Not implemented');
	},
	deleteProject: async () => {
		throw new Error('Not implemented');
	},
	getProjectById: async () => {
		throw new Error('Not implemented');
	},
	getProjects: async () => {
		throw new Error('Not implemented');
	},
	getProjectsByTag: async () => {
		throw new Error('Not implemented');
	},
	getProjectsByType: async (_type: 'latex' | 'typst') => {
		throw new Error('Not implemented');
	},
	searchProjects: async () => {
		throw new Error('Not implemented');
	},
	toggleFavorite: async () => {
		throw new Error('Not implemented');
	},
	verifyPassword: async () => {
		throw new Error('Not implemented');
	},
	updatePassword: async () => {
		throw new Error('Not implemented');
	},
	isGuestUser: () => false,
	cleanupExpiredGuests: async () => {
		throw new Error('Not implemented');
	},
	signInWithGoogle: async () => ({ success: false }),
	linkGoogle: async () => ({ success: false }),
	unlinkGoogle: async () => ({ success: false }),
	requestDriveAccess: async () => ({ success: false }),
});

interface AuthProviderProps {
	children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
	const [user, setUser] = useState<User | null>(null);
	const [isInitializing, setIsInitializing] = useState(true);
	const [googleStatus, setGoogleStatus] = useState<'disconnected' | 'connected' | 'needs_reauth'>('disconnected');
	const { getSetting, registerSetting } = useSettings();

	// Register google-client-id setting and keep GoogleAuthService configured
	useEffect(() => {
		registerSetting({
			id: 'google-client-id',
			category: 'Google',
			subcategory: 'Authentication',
			type: 'text',
			label: 'Google OAuth Client ID',
			description: 'OAuth 2.0 Client ID from Google Cloud Console. Required for Google Sign-In and Drive sync.',
			defaultValue: '',
		});
	}, [registerSetting]);

	useEffect(() => {
		const clientId = (getSetting('google-client-id') as unknown as string) ?? '';
		googleAuthService.configure(clientId);
	}, [getSetting]);

	const deriveGoogleStatus = useCallback(async (u: User | null) => {
		if (!u?.googleId) {
			setGoogleStatus('disconnected');
			return;
		}
		const token = await authService.getGoogleToken(u.id);
		if (token && token.expiresAt > Date.now() + 60_000) {
			setGoogleStatus('connected');
		} else {
			// Try silent refresh
			const refreshed = await googleAuthService.refreshToken(u.id);
			setGoogleStatus(refreshed ? 'connected' : 'needs_reauth');
		}
	}, []);

	useEffect(() => {
		const initAuth = async () => {
			await authService.initialize();
			const currentUser = authService.getCurrentUser();
			setUser(currentUser);
			await deriveGoogleStatus(currentUser);
			setIsInitializing(false);
		};

		initAuth();
	}, [deriveGoogleStatus]);

	const login = async (username: string, password: string): Promise<User> => {
		const loggedInUser = await authService.login(username, password);
		setUser(loggedInUser);
		return loggedInUser;
	};

	const register = async (
		username: string,
		password: string,
		email?: string,
	): Promise<User> => {
		const newUser = await authService.register(username, password, email);
		setUser(newUser);
		return newUser;
	};

	const createGuestAccount = async (): Promise<User> => {
		const guestUser = await authService.createGuestAccount();
		setUser(guestUser);
		return guestUser;
	};

	const upgradeGuestAccount = async (
		username: string,
		password: string,
		email?: string,
	): Promise<User> => {
		const upgradedUser = await authService.upgradeGuestAccount(
			username,
			password,
			email,
		);
		setUser(upgradedUser);
		return upgradedUser;
	};

	const logout = async (): Promise<void> => {
		if (user?.googleId) {
			await googleAuthService.revokeToken(user.id);
		}
		await authService.logout();
		setUser(null);
		setGoogleStatus('disconnected');
	};

	const updateUser = async (updatedUser: User): Promise<User> => {
		const result = await authService.updateUser(updatedUser);
		setUser(result);
		return result;
	};

	const updateUserColor = async (
		userId: string,
		color?: string,
		colorLight?: string,
	): Promise<User> => {
		const updatedUser = await authService.updateUserColor(
			userId,
			color,
			colorLight,
		);
		setUser(updatedUser);
		return updatedUser;
	};

	const createProject = async (
		projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'ownerId'>,
	): Promise<Project> => {
		return authService.createProject(projectData);
	};

	const updateProject = async (project: Project): Promise<Project> => {
		return authService.updateProject(project);
	};

	const deleteProject = async (id: string): Promise<void> => {
		return authService.deleteProject(id);
	};

	const getProjectById = async (id: string): Promise<Project | null> => {
		return authService.getProjectById(id);
	};

	const getProjects = async (): Promise<Project[]> => {
		return authService.getProjectsByUser();
	};

	const getProjectsByTag = async (tag: string): Promise<Project[]> => {
		return authService.getProjectsByTag(tag);
	};

	const getProjectsByType = async (type: 'latex' | 'typst'): Promise<Project[]> => {
		return authService.getProjectsByType(type);
	};

	const searchProjects = async (query: string): Promise<Project[]> => {
		return authService.searchProjects(query);
	};

	const toggleFavorite = async (projectId: string): Promise<Project> => {
		return authService.toggleFavorite(projectId);
	};

	const verifyPassword = async (
		userId: string,
		password: string,
	): Promise<boolean> => {
		return authService.verifyPassword(userId, password);
	};

	const updatePassword = async (
		userId: string,
		newPassword: string,
	): Promise<User> => {
		const updatedUser = await authService.updatePassword(userId, newPassword);
		setUser(updatedUser);
		return updatedUser;
	};

	const isGuestUser = (targetUser?: User | null): boolean => {
		return authService.isGuestUser(targetUser || user);
	};

	const cleanupExpiredGuests = async (): Promise<void> => {
		return authService.cleanupExpiredGuests();
	};

	const signInWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
		try {
			const result = await googleAuthService.signIn();
			if (!result) return { success: false, error: 'Sign-in cancelled' };
			const signedInUser = await authService.signInWithGoogle(result.profile, result.accessToken);
			setUser(signedInUser);
			setGoogleStatus('connected');
			return { success: true };
		} catch (err) {
			const error = err instanceof Error ? err.message : 'Google sign-in failed';
			console.error('[AuthContext] signInWithGoogle error:', err);
			return { success: false, error };
		}
	};

	const linkGoogle = async (): Promise<{ success: boolean; error?: string }> => {
		if (!user) return { success: false, error: 'Not authenticated' };
		try {
			const result = await googleAuthService.signIn();
			if (!result) return { success: false, error: 'Sign-in cancelled' };
			const updatedUser = await authService.linkGoogleAccount(user.id, result.profile, result.accessToken);
			setUser(updatedUser);
			setGoogleStatus('connected');
			return { success: true };
		} catch (err) {
			const error = err instanceof Error ? err.message : 'Failed to link Google account';
			console.error('[AuthContext] linkGoogle error:', err);
			return { success: false, error };
		}
	};

	const unlinkGoogle = async (): Promise<{ success: boolean; error?: string }> => {
		if (!user) return { success: false, error: 'Not authenticated' };
		try {
			await googleAuthService.revokeToken(user.id);
			const updatedUser = await authService.unlinkGoogleAccount(user.id);
			setUser(updatedUser);
			setGoogleStatus('disconnected');
			return { success: true };
		} catch (err) {
			const error = err instanceof Error ? err.message : 'Failed to unlink Google account';
			console.error('[AuthContext] unlinkGoogle error:', err);
			return { success: false, error };
		}
	};

	const requestDriveAccess = async (): Promise<{ success: boolean; error?: string }> => {
		if (!user?.googleId) return { success: false, error: 'Not signed in with Google' };
		try {
			// Re-run interactive sign-in to ensure drive.file scope is granted
			const result = await googleAuthService.signIn();
			if (!result) return { success: false, error: 'Cancelled' };
			await authService.storeGoogleToken({
				userId: user.id,
				accessToken: result.accessToken,
				expiresAt: Date.now() + 55 * 60 * 1000,
				scopes: result.tokenResponse.scope.split(' '),
			});
			setGoogleStatus('connected');
			return { success: true };
		} catch (err) {
			const error = err instanceof Error ? err.message : 'Failed to request Drive access';
			return { success: false, error };
		}
	};

	return (
		<AuthContext.Provider
			value={{
				user,
				isAuthenticated: !!user,
				isInitializing,
				googleStatus,
				login,
				register,
				createGuestAccount,
				upgradeGuestAccount,
				logout,
				updateUser,
				updateUserColor,
				createProject,
				updateProject,
				deleteProject,
				getProjectById,
				getProjects,
				getProjectsByTag,
				getProjectsByType,
				searchProjects,
				toggleFavorite,
				verifyPassword,
				updatePassword,
				isGuestUser,
				cleanupExpiredGuests,
				signInWithGoogle,
				linkGoogle,
				unlinkGoogle,
				requestDriveAccess,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
};