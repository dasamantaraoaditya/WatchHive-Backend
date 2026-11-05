import { config } from '../config.js';

/**
 * Returns the canonical, secure public web URL for WatchersHive.
 * Guarantees that links in emails (verification, password reset) ALWAYS
 * point to the real website (https://www.watchershive.com) and NEVER to
 * outdated S3 buckets or untrusted origins.
 */
export function getCanonicalFrontendUrl(): string {
    const rawOrigins = (process.env.FRONTEND_URL || config.cors.origin || '')
        .split(',')
        .map(s => s.trim().replace(/\/+$/, ''))
        .filter(Boolean);

    // 1. Look for verified production domains (watchershive.com / watcherhive.com)
    for (const origin of rawOrigins) {
        // Reject any legacy or S3 buckets
        if (origin.includes('s3-website') || origin.includes('amazonaws.com')) {
            continue;
        }
        if (origin.includes('watchershive.com') || origin.includes('watcherhive.com')) {
            return origin.startsWith('http') ? origin : `https://${origin}`;
        }
    }

    // 2. In production mode, always enforce the primary production domain
    if (config.nodeEnv === 'production') {
        return 'https://www.watchershive.com';
    }

    // 3. In development mode, check for localhost
    for (const origin of rawOrigins) {
        if (origin.includes('s3-website') || origin.includes('amazonaws.com')) {
            continue;
        }
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return origin.startsWith('http') ? origin : `http://${origin}`;
        }
    }

    // 4. Fallback to official production domain
    return 'https://www.watchershive.com';
}
