import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { generateAccessToken } from '../src/utils/jwt.util.js';

describe('User Profile and Public View Routes', () => {
    const validUuid = '53b17fe9-e018-4792-9f94-ea7de4f264fc';
    const testToken = generateAccessToken({
        userId: validUuid,
        email: 'test@watchershive.com',
        tokenVersion: 1,
        isEmailVerified: true,
    });

    it('allows unauthenticated requests to public profiles', async () => {
        const res = await request(app).get(`/api/v1/users/${validUuid}`);
        expect([200, 404]).toContain(res.status);
        if (res.status === 200) {
            expect(res.body).toHaveProperty('id');
            expect(res.body).toHaveProperty('username');
            expect(res.body).toHaveProperty('_count');
        }
    });

    it('resolves profile by username without 500 uuid parse errors', async () => {
        const res = await request(app)
            .get('/api/v1/users/Ashik')
            .set('Authorization', `Bearer ${testToken}`);
        expect([200, 404]).toContain(res.status);
        if (res.status === 200) {
            expect(res.body.username.toLowerCase()).toBe('ashik');
        }
    });

    it('allows unauthenticated access to public watchlist', async () => {
        const res = await request(app).get(`/api/v1/users/${validUuid}/watchlist`);
        expect([200, 404]).toContain(res.status);
    });

    it('retrieves follow stats with optional auth', async () => {
        const res = await request(app).get(`/api/v1/follows/stats/${validUuid}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('followersCount');
        expect(res.body).toHaveProperty('followingCount');
        expect(typeof res.body.followersCount).toBe('number');
    });
});
