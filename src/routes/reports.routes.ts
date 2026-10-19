import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { db } from '../db/index.js';
import { reports } from '../db/schema.js';

const router = Router();

/**
 * @openapi
 * /api/v1/reports:
 *   post:
 *     tags: [Moderation]
 *     summary: Submit a content/user report (Apple App Store Guideline 1.2)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetType, targetId, reason]
 *             properties:
 *               targetType:
 *                 type: string
 *                 enum: [ENTRY, COMMENT, USER]
 *               targetId:
 *                 type: string
 *               reason:
 *                 type: string
 *               details:
 *                 type: string
 *     responses:
 *       201:
 *         description: Report submitted successfully
 */
router.post('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const reporterId = req.user!.userId;
        const { targetType, targetId, reason, details } = req.body;

        if (!targetType || !targetId || !reason) {
            res.status(400).json({ error: 'targetType, targetId, and reason are required' });
            return;
        }

        const validTypes = ['ENTRY', 'COMMENT', 'USER'];
        const normalizedType = String(targetType).toUpperCase();
        if (!validTypes.includes(normalizedType)) {
            res.status(400).json({ error: 'targetType must be ENTRY, COMMENT, or USER' });
            return;
        }

        const [report] = await db.insert(reports).values({
            reporterId,
            targetType: normalizedType,
            targetId: String(targetId),
            reason: String(reason),
            details: details ? String(details) : null,
        }).returning();

        console.log(`[Moderation] Report filed by ${reporterId} against ${normalizedType} ${targetId} for: ${reason}`);

        res.status(201).json({
            success: true,
            message: 'Report submitted successfully. Our team will review this content within 24 hours.',
            reportId: report.id,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
