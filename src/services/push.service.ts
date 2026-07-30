import webpush from 'web-push';
import { db } from '../db/index.js';
import { pushSubscriptions } from '../db/schema.js';
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
     * Send push notification to all of a user's subscriptions
     */
    sendPushNotification: async (userId: string, type: string, content: any) => {
        if (!config.vapid.publicKey || !config.vapid.privateKey) {
            return; // VAPID not configured, skip push
        }

        try {
            const subscriptions = await db
                .select()
                .from(pushSubscriptions)
                .where(eq(pushSubscriptions.userId, userId));

            if (subscriptions.length === 0) return;

            const payload = JSON.stringify({
                title: formatPushTitle(type),
                body: formatPushBody(type, content),
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-96x96.png',
                url: getNotificationUrl(type, content),
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
                        // 410 Gone or 404 = subscription expired, remove it
                        if (error.statusCode === 410 || error.statusCode === 404) {
                            console.log(`[Push] Removing expired subscription for user ${userId}`);
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
                console.log(`[Push] Sent to ${successful}/${subscriptions.length} subscriptions for user ${userId}`);
            }
        } catch (error) {
            console.error('[Push] Error in sendPushNotification:', error);
        }
    },

    /**
     * Get VAPID public key for frontend
     */
    getVapidPublicKey: () => config.vapid.publicKey,
};

export default pushService;
