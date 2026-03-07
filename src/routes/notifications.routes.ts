import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import notificationService from '../services/notification.service.js';

const router = Router();

/**
 * @route   GET /api/notifications
 * @desc    Get user notifications
 * @access  Private
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
 * @route   GET /api/notifications/unread-count
 * @desc    Get count of unread notifications
 * @access  Private
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
 * @route   PATCH /api/notifications/:notificationId/read
 * @desc    Mark notification as read
 * @access  Private
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
 * @route   PATCH /api/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
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
