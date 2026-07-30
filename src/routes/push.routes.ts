import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import pushService from '../services/push.service.js';

const router = Router();

/**
 * @openapi
 * tags:
 *   name: Push
 *   description: Web Push notification subscription management
 */

/**
 * @openapi
 * /api/v1/push/vapid-public-key:
 *   get:
 *     tags: [Push]
 *     summary: Get VAPID public key for push subscription
 *     responses:
 *       200:
 *         description: VAPID public key
 */
router.get('/vapid-public-key', (_req: Request, res: Response) => {
    const publicKey = pushService.getVapidPublicKey();
    if (!publicKey) {
        res.status(503).json({ error: 'Push notifications are not configured' });
        return;
    }
    res.json({ publicKey });
});

/**
 * @openapi
 * /api/v1/push/subscribe:
 *   post:
 *     tags: [Push]
 *     summary: Subscribe to push notifications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subscription]
 *             properties:
 *               subscription:
 *                 type: object
 *                 properties:
 *                   endpoint:
 *                     type: string
 *                   keys:
 *                     type: object
 *                     properties:
 *                       p256dh:
 *                         type: string
 *                       auth:
 *                         type: string
 *     responses:
 *       200:
 *         description: Successfully subscribed
 */
router.post('/subscribe', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { subscription } = req.body;

        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
            res.status(400).json({ error: 'Invalid push subscription data' });
            return;
        }

        const userAgent = req.headers['user-agent'] || undefined;
        const success = await pushService.saveSubscription(userId, subscription, userAgent);

        if (success) {
            res.json({ success: true, message: 'Push subscription saved' });
        } else {
            res.status(500).json({ error: 'Failed to save push subscription' });
        }
    } catch (error) {
        console.error('Error subscribing to push:', error);
        res.status(500).json({ error: 'Failed to subscribe' });
    }
});

/**
 * @openapi
 * /api/v1/push/unsubscribe:
 *   delete:
 *     tags: [Push]
 *     summary: Unsubscribe from push notifications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endpoint:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successfully unsubscribed
 */
router.delete('/unsubscribe', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { endpoint } = req.body;

        if (!endpoint) {
            res.status(400).json({ error: 'Endpoint is required' });
            return;
        }

        const success = await pushService.removeSubscription(endpoint);
        res.json({ success, message: success ? 'Unsubscribed' : 'Subscription not found' });
    } catch (error) {
        console.error('Error unsubscribing:', error);
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

export default router;
