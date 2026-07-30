import { db } from '../db/index.js';
import { notifications } from '../db/schema.js';
import { eq, and, desc, count } from 'drizzle-orm';
import sseManager from './sse.service.js';
import pushService from './push.service.js';

export const notificationService = {
    /**
     * Create a notification for a user.
     * After DB insert, pushes real-time via SSE and Web Push.
     */
    createNotification: async (
        userId: string,
        type: any,
        content: any
    ) => {
        try {
            // Don't notify yourself
            if (content.actorId === userId) return null;

            const [newNotification] = await db.insert(notifications).values({
                userId,
                type,
                content,
            }).returning();

            // 1. Real-time SSE push (instant in-app delivery)
            sseManager.sendToUser(userId, 'notification', newNotification);

            // Also send updated unread count
            const unreadCount = await notificationService.getUnreadCount(userId);
            sseManager.sendToUser(userId, 'unread-count', { count: unreadCount });

            // 2. Web Push (native OS notification for background/closed app)
            // Fire and forget — don't block the response
            pushService.sendPushNotification(userId, type, content).catch((err) => {
                console.error('[Notification] Web push failed (non-blocking):', err);
            });

            return newNotification;
        } catch (error) {
            console.error('Error creating notification:', error);
            return null;
        }
    },

    /**
     * Get user notifications
     */
    getNotifications: async (userId: string, page = 1, limit = 20) => {
        const offset = (page - 1) * limit;
        return await db
            .select()
            .from(notifications)
            .where(eq(notifications.userId, userId))
            .orderBy(desc(notifications.createdAt))
            .limit(limit)
            .offset(offset);
    },

    /**
     * Mark notification as read
     */
    markAsRead: async (notificationId: string, userId: string) => {
        return await db
            .update(notifications)
            .set({ isRead: true })
            .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
    },

    /**
     * Mark all notifications as read
     */
    markAllAsRead: async (userId: string) => {
        return await db
            .update(notifications)
            .set({ isRead: true })
            .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    },

    /**
     * Get unread count
     */
    getUnreadCount: async (userId: string) => {
        const [result] = await db
            .select({ value: count() })
            .from(notifications)
            .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
        return result?.value || 0;
    }
};

export default notificationService;
