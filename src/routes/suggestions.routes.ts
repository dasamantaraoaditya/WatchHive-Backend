import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { db } from '../db/index.js';
import { users, suggestions, follows } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import notificationService from '../services/notification.service.js';

const router = Router();

/**
 * @openapi
 * /api/v1/suggestions:
 *   post:
 *     tags: [Suggestions]
 *     summary: Suggest a movie to another user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toUserId, tmdbId, title]
 *             properties:
 *               toUserId:
 *                 type: string
 *               tmdbId:
 *                 type: integer
 *               mediaType:
 *                 type: string
 *               title:
 *                 type: string
 *               message:
 *                 type: string
 *     responses:
 *       201:
 *         description: Suggestion sent
 */
router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { toUserId, toUserIds, tmdbId, mediaType = 'movie', title, message } = req.body;
        const fromUserId = req.user!.userId;

        // Parse target user IDs (support single toUserId or array toUserIds)
        let targetIds: string[] = [];
        if (Array.isArray(toUserIds) && toUserIds.length > 0) {
            targetIds = toUserIds.filter((id: any) => typeof id === 'string');
        } else if (typeof toUserId === 'string' && toUserId.trim()) {
            targetIds = [toUserId.trim()];
        }

        // Deduplicate and filter out self
        targetIds = Array.from(new Set(targetIds)).filter(id => id !== fromUserId);

        if (targetIds.length === 0) {
            res.status(400).json({ error: 'Please select at least one valid recipient' });
            return;
        }

        const [actor] = await db
            .select({ displayName: users.displayName, username: users.username })
            .from(users)
            .where(eq(users.id, fromUserId))
            .limit(1);

        const actorName = actor?.displayName || actor?.username || 'Someone';

        const createdSuggestions: any[] = [];
        const errors: string[] = [];

        for (const recipientId of targetIds) {
            try {
                // Validate connection (either following or followed by)
                const [isFollowing] = await db
                    .select()
                    .from(follows)
                    .where(and(eq(follows.followerId, fromUserId), eq(follows.followingId, recipientId)))
                    .limit(1);

                const [isFollowedBy] = await db
                    .select()
                    .from(follows)
                    .where(and(eq(follows.followerId, recipientId), eq(follows.followingId, fromUserId)))
                    .limit(1);

                if (!isFollowing && !isFollowedBy) {
                    errors.push(`Not connected with user ${recipientId}`);
                    continue;
                }

                const [suggestion] = await db
                    .insert(suggestions)
                    .values({
                        fromUserId,
                        toUserId: recipientId,
                        tmdbId,
                        mediaType,
                        message: message?.trim() || null,
                    })
                    .returning();

                // Trigger real-time SSE + Web Push Notification
                await notificationService.createNotification(recipientId, 'SUGGESTION', {
                    actorId: fromUserId,
                    actorName,
                    tmdbId,
                    mediaType,
                    title,
                    message: message?.trim() || null
                });

                createdSuggestions.push(suggestion);
            } catch (err: any) {
                console.error(`Failed to send suggestion to ${recipientId}:`, err);
            }
        }

        if (createdSuggestions.length === 0) {
            res.status(403).json({ error: errors[0] || 'Could not send suggestions to selected users' });
            return;
        }

        res.status(201).json({
            message: `Suggestion sent to ${createdSuggestions.length} user(s)`,
            count: createdSuggestions.length,
            suggestions: createdSuggestions,
            ...createdSuggestions[0]
        });
    } catch (error) {
        console.error('Error sending suggestions:', error);
        res.status(500).json({ error: 'Failed to send suggestions' });
    }
});

/**
 * @openapi
 * /api/v1/suggestions/me:
 *   get:
 *     tags: [Suggestions]
 *     summary: Get suggestions sent to the current user
 */
router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.userId;

        const results = await db
            .select({
                suggestion: suggestions,
                fromUser: {
                    id: users.id,
                    username: users.username,
                    displayName: users.displayName,
                    profilePictureUrl: users.profilePictureUrl
                }
            })
            .from(suggestions)
            .innerJoin(users, eq(suggestions.fromUserId, users.id))
            .where(eq(suggestions.toUserId, userId))
            .orderBy(desc(suggestions.createdAt));

        // Group by tmdbId
        const grouped = results.reduce((acc: any, item) => {
            const key = `${item.suggestion.mediaType}-${item.suggestion.tmdbId}`;
            if (!acc[key]) {
                acc[key] = {
                    tmdbId: item.suggestion.tmdbId,
                    mediaType: item.suggestion.mediaType,
                    suggestions: [],
                    suggestors: []
                };
            }
            acc[key].suggestions.push(item.suggestion);
            acc[key].suggestors.push(item.fromUser);
            return acc;
        }, {});

        res.json(Object.values(grouped));
    } catch (error) {
        console.error('Error fetching suggestions:', error);
        res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
});

/**
 * @openapi
 * /api/v1/suggestions/{id}:
 *   delete:
 *     tags: [Suggestions]
 */
router.delete('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = req.user!.userId;

        const [suggestion] = await db
            .select()
            .from(suggestions)
            .where(eq(suggestions.id, id))
            .limit(1);

        if (!suggestion) {
            res.status(404).json({ error: 'Suggestion not found' });
            return;
        }

        if (suggestion.toUserId !== userId && suggestion.fromUserId !== userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        await db.delete(suggestions).where(eq(suggestions.id, id));
        res.json({ message: 'Suggestion removed' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete suggestion' });
    }
});

export default router;
