import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Compare two semver strings: returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
export function compareSemver(v1: string, v2: string): number {
    const parts1 = v1.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
    const parts2 = v2.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
        const num1 = parts1[i] ?? 0;
        const num2 = parts2[i] ?? 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}

export function getAppVersionConfig(platform: 'ios' | 'android') {
    const isIos = platform === 'ios';

    const latestVersion = isIos
        ? (process.env.APP_LATEST_VERSION_IOS || '1.0.44')
        : (process.env.APP_LATEST_VERSION_ANDROID || '1.0.44');

    const minimumVersion = isIos
        ? (process.env.APP_MIN_VERSION_IOS || '1.0.0')
        : (process.env.APP_MIN_VERSION_ANDROID || '1.0.0');

    const storeUrl = isIos
        ? (process.env.APP_STORE_URL_IOS || 'https://apps.apple.com/app/watchershive/id6740000000')
        : (process.env.APP_STORE_URL_ANDROID || 'https://play.google.com/store/apps/details?id=com.watchhive.watchhive_mobile');

    const releaseNotes = process.env.APP_RELEASE_NOTES ||
        '• Honey Level Badges & Daily Watch Streak tracking\n• Performance optimizations and bug fixes\n• Enhanced movie and show details';

    return { latestVersion, minimumVersion, storeUrl, releaseNotes };
}

/**
 * @openapi
 * /api/v1/app/version:
 *   get:
 *     summary: Check for latest mobile app version and update requirements
 *     tags: [App]
 *     parameters:
 *       - in: query
 *         name: platform
 *         schema:
 *           type: string
 *           enum: [ios, android]
 *         required: false
 *         description: Operating platform (ios or android)
 *       - in: query
 *         name: currentVersion
 *         schema:
 *           type: string
 *         required: false
 *         description: Current installed client version (e.g. 1.0.44)
 *     responses:
 *       200:
 *         description: App version metadata and update status
 */
router.get('/version', (req: Request, res: Response) => {
    const platform = (String(req.query.platform || 'ios').toLowerCase() === 'android') ? 'android' : 'ios';
    const currentVersion = String(req.query.currentVersion || '1.0.0').trim();

    const { latestVersion, minimumVersion, storeUrl, releaseNotes } = getAppVersionConfig(platform);

    const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;
    const forceUpdate = compareSemver(currentVersion, minimumVersion) < 0;

    res.json({
        platform,
        currentVersion,
        latestVersion,
        minimumVersion,
        updateAvailable,
        forceUpdate,
        releaseNotes,
        storeUrl,
    });
});

export default router;
