import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import notificationService from '../services/notification.service.js';

const router = Router();

/**
 * @openapi
 * tags:
 *   name: Notifications
 *   description: User notifications management
 */

/**
 * @openapi
 * /api/v1/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Get user notifications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Notifications list
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;

        const [notifications, unreadCount] = await Promise.all([
            notificationService.getNotifications(userId, page, limit),
            notificationService.getUnreadCount(userId)
        ]);

        res.json({
            notifications,
            unreadCount,
            pagination: {
                page,
                limit
            }
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

/**
 * @openapi
 * /api/v1/notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Get count of unread notifications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count
 */
router.get('/unread-count', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        const count = await notificationService.getUnreadCount(userId);
        res.json({ count });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * @openapi
 * /api/v1/notifications/{notificationId}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark notification as read
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully marked as read
 */
router.patch('/:notificationId/read', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { notificationId } = req.params;
        const userId = req.user!.userId;

        await notificationService.markAsRead(notificationId, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * @openapi
 * /api/v1/notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark all notifications as read
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully marked all as read
 */
router.patch('/read-all', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        await notificationService.markAllAsRead(userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

export default router;
