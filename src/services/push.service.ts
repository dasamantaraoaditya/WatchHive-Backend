import webpush from 'web-push';
import { initializeApp, cert, type App } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage, type SendResponse } from 'firebase-admin/messaging';
import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { pushSubscriptions, deviceTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';

// Configure web-push with VAPID keys
if (config.vapid.publicKey && config.vapid.privateKey) {
    webpush.setVapidDetails(
        config.vapid.subject,
        config.vapid.publicKey,
        config.vapid.privateKey
    );
}

// Configure Firebase Admin for Mobile Push (FCM)
let firebaseApp: App | null = null;
let firebaseInitError: string | null = null;

function parseServiceAccount(rawKey: string): any {
    let key = rawKey.trim();

    // 1. Strip surrounding single or double quotes
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1).trim();
    }

    // 2. Base64 encoded JSON support (standard for cloud environments like Railway)
    if (!key.startsWith('{') && /^[A-Za-z0-9+/=]+$/.test(key.replace(/\s+/g, ''))) {
        try {
            const decoded = Buffer.from(key, 'base64').toString('utf-8').trim();
            if (decoded.startsWith('{')) {
                key = decoded;
            }
        } catch {
            // Not valid base64 or doesn't decode to JSON; fall through to file checks
        }
    }

    // 3. Raw or unescaped JSON string
    if (key.startsWith('{')) {
        const parsed = JSON.parse(key);
        if (parsed.private_key && typeof parsed.private_key === 'string') {
            parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        return parsed;
    }

    // 4. File path
    const resolvedPath = path.isAbsolute(key) ? key : path.resolve(process.cwd(), key);
    if (fs.existsSync(resolvedPath)) {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.private_key && typeof parsed.private_key === 'string') {
            parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        return parsed;
    } else if (fs.existsSync(key)) {
        const content = fs.readFileSync(key, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.private_key && typeof parsed.private_key === 'string') {
            parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        return parsed;
    }

    throw new Error(`Firebase service account key is neither valid JSON, base64 JSON, nor an existing file path at ${resolvedPath}`);
}

if (config.firebase?.serviceAccountKey) {
    try {
        const serviceAccount = parseServiceAccount(config.firebase.serviceAccountKey);
        if (serviceAccount) {
            firebaseApp = initializeApp({
                credential: cert(serviceAccount),
            });
            console.log('[Push] Firebase Admin initialized for Mobile Push.');
        }
    } catch (err: any) {
        firebaseInitError = err?.message || String(err);
        console.error('[Push] Failed to initialize Firebase Admin SDK:', err);
    }
} else {
    firebaseInitError = 'FIREBASE_SERVICE_ACCOUNT_KEY environment variable not provided';
    console.log('[Push] Firebase service account key not provided; mobile FCM push inactive.');
}

/**
 * Format notification type into a human-readable push title
 */
function formatPushTitle(type: string): string {
    switch (type) {
        case 'LIKE': return '❤️ New Like';
        case 'COMMENT': return '💬 New Comment';
        case 'REPLY': return '↩️ New Reply';
        case 'FOLLOW': return '👤 New Follower';
        case 'FOLLOW_REQUEST': return '🔔 Follow Request';
        case 'FOLLOW_ACCEPT': return '✅ Follow Accepted';
        case 'FOLLOW_REJECT': return '❌ Follow Declined';
        case 'SUGGESTION': return '🎬 Movie Suggestion';
        case 'MENTION': return '📢 Mentioned You';
        default: return '🐝 WatchHive';
    }
}

/**
 * Format notification content into a push body string
 */
function formatPushBody(type: string, content: any): string {
    const actor = content.actorName || 'Someone';
    const title = content.entryTitle || '';

    switch (type) {
        case 'LIKE':
            return `${actor} liked your entry "${title}"`;
        case 'COMMENT':
            return `${actor} commented on "${title}"`;
        case 'REPLY':
            return content.contentSnippet
                ? `${actor} replied: "${content.contentSnippet.slice(0, 60)}"`
                : `${actor} replied to your comment`;
        case 'FOLLOW':
            return `${actor} started following you`;
        case 'FOLLOW_REQUEST':
            return `${actor} wants to follow you`;
        case 'FOLLOW_ACCEPT':
            return `${actor} accepted your follow request`;
        case 'FOLLOW_REJECT':
            return `${actor} declined your follow request`;
        case 'SUGGESTION':
            return title
                ? `${actor} suggested "${title}" for you`
                : `${actor} sent you a movie suggestion`;
        case 'MENTION':
            return `${actor} mentioned you`;
        default:
            return `${actor} interacted with your content`;
    }
}

/**
 * Get the URL to navigate to when the push notification is clicked
 */
function getNotificationUrl(type: string, _content: any): string {
    switch (type) {
        case 'LIKE':
        case 'COMMENT':
        case 'REPLY':
            return '/watch-hive/feed';
        case 'FOLLOW':
        case 'FOLLOW_REQUEST':
        case 'FOLLOW_ACCEPT':
        case 'FOLLOW_REJECT':
            return '/watch-hive/notifications';
        case 'SUGGESTION':
            return '/watch-hive/notifications';
        default:
            return '/watch-hive/notifications';
    }
}

export const pushService = {
    /**
     * Save a push subscription for a user
     */
    saveSubscription: async (userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) => {
        try {
            // Upsert: if endpoint already exists, update the keys
            const [existing] = await db
                .select()
                .from(pushSubscriptions)
                .where(eq(pushSubscriptions.endpoint, subscription.endpoint))
                .limit(1);

            if (existing) {
                await db
                    .update(pushSubscriptions)
                    .set({
                        userId,
                        p256dh: subscription.keys.p256dh,
                        auth: subscription.keys.auth,
                        userAgent: userAgent || null,
                    })
                    .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
            } else {
                await db.insert(pushSubscriptions).values({
                    userId,
                    endpoint: subscription.endpoint,
                    p256dh: subscription.keys.p256dh,
                    auth: subscription.keys.auth,
                    userAgent: userAgent || null,
                });
            }

            return true;
        } catch (error) {
            console.error('[Push] Error saving subscription:', error);
            return false;
        }
    },

    /**
     * Remove a push subscription by endpoint
     */
    removeSubscription: async (endpoint: string) => {
        try {
            await db
                .delete(pushSubscriptions)
                .where(eq(pushSubscriptions.endpoint, endpoint));
            return true;
        } catch (error) {
            console.error('[Push] Error removing subscription:', error);
            return false;
        }
    },
    /**
     * Save a mobile device FCM token for a user
     */
    saveDeviceToken: async (userId: string, token: string, platform = 'android') => {
        try {
            const [existing] = await db
                .select()
                .from(deviceTokens)
                .where(eq(deviceTokens.token, token))
                .limit(1);

            if (existing) {
                await db
                    .update(deviceTokens)
                    .set({
                        userId,
                        platform,
                        updatedAt: new Date(),
                    })
                    .where(eq(deviceTokens.token, token));
            } else {
                await db.insert(deviceTokens).values({
                    userId,
                    token,
                    platform,
                });
            }

            return true;
        } catch (error) {
            console.error('[Push] Error saving device token:', error);
            return false;
        }
    },

    /**
     * Remove a mobile device FCM token upon logout
     */
    removeDeviceToken: async (token: string) => {
        try {
            await db
                .delete(deviceTokens)
                .where(eq(deviceTokens.token, token));
            return true;
        } catch (error) {
            console.error('[Push] Error removing device token:', error);
            return false;
        }
    },

    /**
     * Send push notification to all of a user's subscriptions (Web Push + Mobile FCM)
     */
    sendPushNotification: async (userId: string, type: string, content: any) => {
        const pushTitle = formatPushTitle(type);
        const pushBody = formatPushBody(type, content);
        const notificationUrl = getNotificationUrl(type, content);

        // 1. Web Push Dispatch
        if (config.vapid.publicKey && config.vapid.privateKey) {
            try {
                const subscriptions = await db
                    .select()
                    .from(pushSubscriptions)
                    .where(eq(pushSubscriptions.userId, userId));

                if (subscriptions.length > 0) {
                    const payload = JSON.stringify({
                        title: pushTitle,
                        body: pushBody,
                        icon: '/icons/icon-192x192.png',
                        badge: '/icons/icon-96x96.png',
                        url: notificationUrl,
                        tag: `watchhive-${type}-${Date.now()}`,
                    });

                    const results = await Promise.allSettled(
                        subscriptions.map(async (sub) => {
                            try {
                                await webpush.sendNotification(
                                    {
                                        endpoint: sub.endpoint,
                                        keys: {
                                            p256dh: sub.p256dh,
                                            auth: sub.auth,
                                        },
                                    },
                                    payload
                                );
                            } catch (error: any) {
                                if (error.statusCode === 410 || error.statusCode === 404) {
                                    console.log(`[Push] Removing expired web subscription for user ${userId}`);
                                    await db
                                        .delete(pushSubscriptions)
                                        .where(eq(pushSubscriptions.endpoint, sub.endpoint));
                                } else {
                                    console.error(`[Push] Error sending to ${sub.endpoint}:`, error.message);
                                }
                            }
                        })
                    );

                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    if (successful > 0) {
                        console.log(`[Push] Web push sent to ${successful}/${subscriptions.length} subscriptions for user ${userId}`);
                    }
                }
            } catch (error) {
                console.error('[Push] Error in Web Push sendPushNotification:', error);
            }
        }

        // 2. Mobile FCM Push Dispatch
        try {
            const mobileTokens = await db
                .select()
                .from(deviceTokens)
                .where(eq(deviceTokens.userId, userId));

            if (mobileTokens.length > 0) {
                if (!firebaseApp) {
                    console.log(`[Push] User ${userId} has ${mobileTokens.length} registered mobile device(s), but Firebase Admin is unconfigured.`);
                } else {
                    const tokens = mobileTokens.map(t => t.token);

                    const fcmPayload: MulticastMessage = {
                        tokens,
                        notification: {
                            title: pushTitle,
                            body: pushBody,
                        },
                        data: {
                            type: String(type),
                            title: pushTitle,
                            body: pushBody,
                            url: notificationUrl,
                            ...Object.fromEntries(
                                Object.entries(content || {}).map(([k, v]) => [k, String(v ?? '')])
                            ),
                        },
                        android: {
                            priority: 'high',
                            notification: {
                                channelId: 'watchhive_high_importance_channel',
                                icon: 'ic_launcher',
                                color: '#FFB700',
                            },
                        },
                        apns: {
                            payload: {
                                aps: {
                                    sound: 'default',
                                    badge: 1,
                                },
                            },
                        },
                    };

                    const messaging = getMessaging(firebaseApp);
                    const response = await messaging.sendEachForMulticast(fcmPayload);
                    console.log(`[Push] FCM sent: ${response.successCount} successful, ${response.failureCount} failed out of ${tokens.length}`);

                    // Prune dead/invalid tokens
                    response.responses.forEach(async (resp: SendResponse, idx: number) => {
                        if (!resp.success) {
                            const errCode = resp.error?.code;
                            if (
                                errCode === 'messaging/invalid-registration-token' ||
                                errCode === 'messaging/registration-token-not-registered'
                            ) {
                                console.log(`[Push] Removing invalid FCM token ${tokens[idx]}`);
                                await db.delete(deviceTokens).where(eq(deviceTokens.token, tokens[idx]));
                            }
                        }
                    });
                }
            }
        } catch (fcmError) {
            console.error('[Push] Error in FCM sendPushNotification:', fcmError);
        }
    },

    /**
     * Get VAPID public key for frontend
     */
    getVapidPublicKey: () => config.vapid.publicKey,

    /**
     * Get push services configuration & health status
     */
    getStatus: () => ({
        webPushConfigured: Boolean(config.vapid.publicKey && config.vapid.privateKey),
        fcmConfigured: Boolean(firebaseApp),
        hasFirebaseKeyEnv: Boolean(config.firebase?.serviceAccountKey),
        firebaseInitError,
    }),
};

export default pushService;
