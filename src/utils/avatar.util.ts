import { config } from '../config.js';

export const getApiBaseUrl = (): string => {
    const raw = process.env.BACKEND_PUBLIC_URL ||
                process.env.API_BASE_URL ||
                (process.env.NODE_ENV === 'production'
                    ? 'https://watchhive-api-production.up.railway.app'
                    : `http://localhost:${process.env.PORT || config.port || 5001}`);
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
};

/**
 * Resolves any database avatar key, relative path, or external URL
 * into a permanent, accessible URL.
 */
export const resolveAvatarUrl = (keyOrUrl: string | null | undefined): string | null => {
    if (!keyOrUrl || typeof keyOrUrl !== 'string' || keyOrUrl.trim() === '') {
        return null;
    }

    const trimmed = keyOrUrl.trim();

    // External URL (e.g. Google Auth avatar)
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        // If it's a temporary signed Tigris/S3 URL that already has an avatar key inside it,
        // extract the filename so we return our permanent, unexpiring endpoint instead.
        const match = trimmed.match(/avatars\/([^?&#]+)/);
        if (match && (trimmed.includes('storageapi.dev') || trimmed.includes('amazonaws.com') || trimmed.includes('railway.app'))) {
            const filename = match[1];
            return `${getApiBaseUrl()}/api/v1/avatars/${filename}`;
        }
        return trimmed;
    }

    // Normalize relative path or raw S3 key
    let filename = trimmed;
    if (filename.startsWith('/uploads/avatars/')) {
        filename = filename.replace('/uploads/avatars/', '');
    } else if (filename.startsWith('uploads/avatars/')) {
        filename = filename.replace('uploads/avatars/', '');
    } else if (filename.startsWith('/uploads/')) {
        filename = filename.replace('/uploads/', '');
    } else if (filename.startsWith('avatars/')) {
        filename = filename.replace('avatars/', '');
    } else if (filename.startsWith('/avatars/')) {
        filename = filename.replace('/avatars/', '');
    } else if (filename.startsWith('/')) {
        filename = filename.slice(1);
    }

    return `${getApiBaseUrl()}/api/v1/avatars/${filename}`;
};

/**
 * Formats a user-like object by replacing profilePictureUrl with its resolved URL
 */
export const formatUserWithAvatar = <T extends { profilePictureUrl?: string | null }>(user: T | null | undefined): T | null => {
    if (!user) return null as any;
    return {
        ...user,
        profilePictureUrl: resolveAvatarUrl(user.profilePictureUrl),
    };
};

/**
 * Formats an array of user-like objects
 */
export const formatUsersWithAvatar = <T extends { profilePictureUrl?: string | null }>(users: T[]): T[] => {
    if (!Array.isArray(users)) return [];
    return users.map(u => formatUserWithAvatar(u)!);
};
