import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import notificationService from '../services/notification.service.js';
import sseManager from '../services/sse.service.js';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const router = Router();

/**
 * @openapi
 * /api/v1/notifications/stream:
 *   get:
 *     tags: [Notifications]
 *     summary: Real-time SSE notification stream
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SSE event stream
 */
router.get('/stream', async (req: Request, res: Response): Promise<void> => {
    try {
        let userId: string | null = null;

        // Try auth header first, fallback to query param for EventSource
        const authHeader = req.headers.authorization;
        const queryToken = req.query.token as string;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : queryToken;

        if (token) {
            try {
                const decoded = jwt.verify(token, config.jwt.secret) as { userId: string };
                userId = decoded.userId;
            } catch {
                res.status(401).json({ error: 'Invalid or expired token' });
                return;
            }
        }

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // Set SSE Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for Nginx/Railway proxies
        res.flushHeaders();

        // Add connection to SSE manager
        sseManager.addConnection(userId, res);

        // Send initial connection event with current unread count
        const unreadCount = await notificationService.getUnreadCount(userId);
        res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', unreadCount })}\n\n`);
    } catch (error) {
        console.error('SSE Stream Error:', error);
        res.status(500).json({ error: 'SSE stream failed' });
    }
});

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
