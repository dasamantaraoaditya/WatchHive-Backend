import { describe, it, expect } from '@jest/globals';
import { compareSemver, getAppVersionConfig } from '../src/routes/app-version.routes.js';
import request from 'supertest';
import app from '../src/app.js';

describe('App Version Logic & Endpoint', () => {
    describe('compareSemver', () => {
        it('returns 0 for identical versions', () => {
            expect(compareSemver('1.0.44', '1.0.44')).toBe(0);
            expect(compareSemver('v1.0.44', '1.0.44')).toBe(0);
        });

        it('detects when v1 is greater than v2', () => {
            expect(compareSemver('1.0.45', '1.0.44')).toBe(1);
            expect(compareSemver('1.1.0', '1.0.44')).toBe(1);
            expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
        });

        it('detects when v1 is less than v2', () => {
            expect(compareSemver('1.0.44', '1.0.45')).toBe(-1);
            expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
            expect(compareSemver('0.9.9', '1.0.0')).toBe(-1);
        });
    });

    describe('GET /api/v1/app/version', () => {
        it('returns app version info for iOS', async () => {
            const res = await request(app)
                .get('/api/v1/app/version?platform=ios&currentVersion=1.0.44')
                .expect(200);

            expect(res.body).toHaveProperty('platform', 'ios');
            expect(res.body).toHaveProperty('latestVersion');
            expect(res.body).toHaveProperty('minimumVersion');
            expect(res.body).toHaveProperty('updateAvailable');
            expect(res.body).toHaveProperty('forceUpdate');
            expect(res.body).toHaveProperty('releaseNotes');
            expect(res.body).toHaveProperty('storeUrl');
        });

        it('detects an update when client version is older than latest', async () => {
            const res = await request(app)
                .get('/api/v1/app/version?platform=android&currentVersion=0.9.0')
                .expect(200);

            expect(res.body.platform).toBe('android');
            expect(res.body.updateAvailable).toBe(true);
        });

        it('flags forceUpdate if client version is below minimum', async () => {
            const res = await request(app)
                .get('/api/v1/app/version?platform=ios&currentVersion=0.5.0')
                .expect(200);

            expect(res.body.forceUpdate).toBe(true);
        });
    });
});
