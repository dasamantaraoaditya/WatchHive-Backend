import { resolveAvatarUrl, formatUserWithAvatar, formatUsersWithAvatar } from '../../src/utils/avatar.util.js';

describe('Avatar Utility Tests', () => {
    it('should return null for null, undefined, or empty strings', () => {
        expect(resolveAvatarUrl(null)).toBeNull();
        expect(resolveAvatarUrl(undefined)).toBeNull();
        expect(resolveAvatarUrl('')).toBeNull();
        expect(resolveAvatarUrl('   ')).toBeNull();
    });

    it('should return external URLs (Google avatars) as-is', () => {
        const googleUrl = 'https://lh3.googleusercontent.com/a/ACg8ocL6gRwNuCEsj__6SAiQOjLm1mcyNn5dHcS4FUopE_M2BZ9J3A=s96-c';
        expect(resolveAvatarUrl(googleUrl)).toBe(googleUrl);
    });

    it('should normalize raw S3 avatar keys into backend avatar URLs', () => {
        const rawKey = 'avatars/a77dc349-60da-455d-b24e-9d031faed57a-1788259938294.jpg';
        const resolved = resolveAvatarUrl(rawKey);
        expect(resolved).toMatch(/\/api\/v1\/avatars\/a77dc349-60da-455d-b24e-9d031faed57a-1788259938294\.jpg$/);
    });

    it('should normalize legacy /uploads/ paths into backend avatar URLs', () => {
        const legacyPath = '/uploads/avatars/9ceed6f3-e2f5-44e8-b358-41db9f7bfdf6-1770991992462.jpg';
        const resolved = resolveAvatarUrl(legacyPath);
        expect(resolved).toMatch(/\/api\/v1\/avatars\/9ceed6f3-e2f5-44e8-b358-41db9f7bfdf6-1770991992462\.jpg$/);
    });

    it('should normalize temporary signed Tigris/S3 URLs with avatar keys into permanent URLs', () => {
        const signedUrl = 'https://t3.storageapi.dev/watchhive-bucket-7zfstcmz/avatars/test-user-123.jpg?X-Amz-Expires=3600&X-Amz-Signature=xyz';
        const resolved = resolveAvatarUrl(signedUrl);
        expect(resolved).toMatch(/\/api\/v1\/avatars\/test-user-123\.jpg$/);
    });

    it('should format user objects with resolved profilePictureUrl', () => {
        const user = {
            id: '123',
            username: 'test',
            profilePictureUrl: 'avatars/123-avatar.png'
        };
        const formatted = formatUserWithAvatar(user);
        expect(formatted).not.toBeNull();
        expect(formatted!.profilePictureUrl).toMatch(/\/api\/v1\/avatars\/123-avatar\.png$/);
    });

    it('should format arrays of user objects', () => {
        const users = [
            { id: '1', profilePictureUrl: 'avatars/u1.jpg' },
            { id: '2', profilePictureUrl: 'https://lh3.googleusercontent.com/avatar' },
            { id: '3', profilePictureUrl: null }
        ];
        const formatted = formatUsersWithAvatar(users);
        expect(formatted).toHaveLength(3);
        expect(formatted[0].profilePictureUrl).toMatch(/\/api\/v1\/avatars\/u1\.jpg$/);
        expect(formatted[1].profilePictureUrl).toBe('https://lh3.googleusercontent.com/avatar');
        expect(formatted[2].profilePictureUrl).toBeNull();
    });
});
