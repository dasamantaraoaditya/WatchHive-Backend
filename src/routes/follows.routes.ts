import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { db } from '../db/index.js';
import { users, follows, followRequests } from '../db/schema.js';
import { eq, and, desc, count } from 'drizzle-orm';
import notificationService from '../services/notification.service.js';

const router = Router();

/**
 * @openapi
 * tags:
 *   name: Follows
 *   description: User follow and connection management
 */

/**
 * @openapi
 * /api/v1/follows/{userId}:
 *   post:
 *     tags: [Follows]
 *     summary: Follow a user
 *     description: Follow a user (or send follow request if private)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Success (Followed or Requested)
 *       404:
 *         description: User not found
 */
router.post('/:userId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const followingId = req.params.userId;
        const followerId = req.user!.userId;

        if (followerId === followingId) {
            res.status(400).json({ error: 'You cannot follow yourself' });
            return;
        }

        const [userToFollow] = await db
            .select()
            .from(users)
            .where(eq(users.id, followingId))
            .limit(1);

        if (!userToFollow) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // 1. Check if already following
        const [existingFollow] = await db
            .select()
            .from(follows)
            .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
            .limit(1);

        if (existingFollow) {
            res.status(400).json({ error: 'You are already following this user' });
            return;
        }

        // 2. Check if there's a pending request
        const [existingRequest] = await db
            .select()
            .from(followRequests)
            .where(and(eq(followRequests.senderId, followerId), eq(followRequests.recipientId, followingId)))
            .limit(1);

        if (existingRequest) {
            if (existingRequest.status === 'pending') {
                res.status(400).json({ error: 'Follow request already pending' });
                return;
            }
            await db.delete(followRequests).where(eq(followRequests.id, existingRequest.id));
        }

        const [actor] = await db
            .select({ username: users.username, displayName: users.displayName })
            .from(users)
            .where(eq(users.id, followerId))
            .limit(1);
        const actorName = actor?.displayName || actor?.username || 'Someone';

        // 3. Handle Private vs Public
        if (userToFollow.isPrivate) {
            const [request] = await db
                .insert(followRequests)
                .values({ senderId: followerId, recipientId: followingId })
                .returning();

            await notificationService.createNotification(followingId, 'FOLLOW_REQUEST', {
                actorId: followerId,
                actorName,
                requestId: request.id
            });

            res.status(201).json({ message: 'Follow request sent', status: 'requested' });
        } else {
            const [follow] = await db
                .insert(follows)
                .values({ followerId, followingId })
                .returning();

            // Fetch following details for response parity
            const [followingDetails] = await db
                .select({
                    id: users.id,
                    username: users.username,
                    displayName: users.displayName,
                    profilePictureUrl: users.profilePictureUrl
                })
                .from(users)
                .where(eq(users.id, followingId))
                .limit(1);

            await notificationService.createNotification(followingId, 'FOLLOW', {
                actorId: followerId,
                actorName
            });

            res.status(201).json({
                message: 'Successfully followed user',
                follow: { ...follow, following: followingDetails },
                status: 'following'
            });
        }
    } catch (error) {
        console.error('Error following user:', error);
        res.status(500).json({ error: 'Failed to follow user' });
    }
});

/**
 * @openapi
 * /api/v1/follows/requests/{requestId}/accept:
 *   post:
 *     tags: [Follows]
 *     summary: Accept a follow request
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Follow request accepted
 *       404:
 *         description: Request not found
 */
router.post('/requests/:requestId/accept', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;
        const userId = req.user!.userId;

        const [request] = await db
            .select()
            .from(followRequests)
            .where(eq(followRequests.id, requestId))
            .limit(1);

        if (!request || request.recipientId !== userId) {
            res.status(404).json({ error: 'Request not found' });
            return;
        }

        await db.insert(follows).values({ followerId: request.senderId, followingId: userId });
        await db.delete(followRequests).where(eq(followRequests.id, requestId));

        const [recipient] = await db
            .select({ username: users.username, displayName: users.displayName })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        await notificationService.createNotification(request.senderId, 'FOLLOW_ACCEPT', {
            actorId: userId,
            actorName: recipient?.displayName || recipient?.username || 'Someone'
        });

        res.json({ message: 'Follow request accepted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to accept' });
    }
});

/**
 * @openapi
 * /api/v1/follows/requests/{requestId}/reject:
 *   post:
 *     tags: [Follows]
 *     summary: Reject a follow request
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Follow request rejected
 *       404:
 *         description: Request not found
 */
router.post('/requests/:requestId/reject', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;
        const userId = req.user!.userId;

        const [request] = await db
            .select()
            .from(followRequests)
            .where(eq(followRequests.id, requestId))
            .limit(1);

        if (!request || request.recipientId !== userId) {
            res.status(404).json({ error: 'Request not found' });
            return;
        }

        await db.delete(followRequests).where(eq(followRequests.id, requestId));
        res.json({ message: 'Follow request rejected' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject' });
    }
});

/**
 * @openapi
 * /api/v1/follows/requests/pending:
 *   get:
 *     tags: [Follows]
 *     summary: Get pending follow requests
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending requests
 */
router.get('/requests/pending', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.userId;
        const requests = await db
            .select({
                id: followRequests.id,
                senderId: followRequests.senderId,
                recipientId: followRequests.recipientId,
                status: followRequests.status,
                createdAt: followRequests.createdAt,
                sender: {
                    id: users.id,
                    username: users.username,
                    displayName: users.displayName,
                    profilePictureUrl: users.profilePictureUrl
                }
            })
            .from(followRequests)
            .innerJoin(users, eq(followRequests.senderId, users.id))
            .where(and(eq(followRequests.recipientId, userId), eq(followRequests.status, 'pending')))
            .orderBy(desc(followRequests.createdAt));

        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

/**
 * @openapi
 * /api/v1/follows/{userId}:
 *   delete:
 *     tags: [Follows]
 *     summary: Unfollow a user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully unfollowed
 *       404:
 *         description: Not following
 */
router.delete('/:userId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const followingId = req.params.userId;
        const followerId = req.user!.userId;

        await db
            .delete(followRequests)
            .where(and(eq(followRequests.senderId, followerId), eq(followRequests.recipientId, followingId)));

        const [existingFollow] = await db
            .select()
            .from(follows)
            .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
            .limit(1);

        if (!existingFollow) {
            res.status(404).json({ error: 'You are not following this user' });
            return;
        }

        await db
            .delete(follows)
            .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)));

        res.json({ message: 'Successfully unfollowed user' });
    } catch (error) {
        console.error('Error unfollowing user:', error);
        res.status(500).json({ error: 'Failed to unfollow user' });
    }
});

/**
 * @openapi
 * /api/v1/follows/{userId}/followers:
 *   get:
 *     tags: [Follows]
 *     summary: Get user's followers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
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
 *         description: List of followers
 */
router.get('/:userId/followers', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.userId;
        const page = parseInt(req.query.page as string, 10) || 1;
        const limit = parseInt(req.query.limit as string, 10) || 20;
        const offset = (page - 1) * limit;

        const [followersList, [{ total }]] = await Promise.all([
            db.select({
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                createdAt: users.createdAt
            })
                .from(follows)
                .innerJoin(users, eq(follows.followerId, users.id))
                .where(eq(follows.followingId, userId))
                .limit(limit)
                .offset(offset)
                .orderBy(desc(follows.createdAt)),
            db.select({ total: count() }).from(follows).where(eq(follows.followingId, userId))
        ]);

        res.json({
            followers: followersList,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * @openapi
 * /api/v1/follows/{userId}/following:
 *   get:
 *     tags: [Follows]
 *     summary: Get users followed by user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
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
 *         description: List of following users
 */
router.get('/:userId/following', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.userId;
        const page = parseInt(req.query.page as string, 10) || 1;
        const limit = parseInt(req.query.limit as string, 10) || 20;
        const offset = (page - 1) * limit;

        const [followingList, [{ total }]] = await Promise.all([
            db.select({
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                createdAt: users.createdAt
            })
                .from(follows)
                .innerJoin(users, eq(follows.followingId, users.id))
                .where(eq(follows.followerId, userId))
                .limit(limit)
                .offset(offset)
                .orderBy(desc(follows.createdAt)),
            db.select({ total: count() }).from(follows).where(eq(follows.followerId, userId))
        ]);

        res.json({
            following: followingList,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * @openapi
 * /api/v1/follows/{userId}/status:
 *   get:
 *     tags: [Follows]
 *     summary: Get follow status between users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Follow status information
 */
router.get('/:userId/status', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const followingId = req.params.userId;
        const followerId = req.user!.userId;

        const [follow] = await db
            .select()
            .from(follows)
            .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
            .limit(1);

        const [request] = await db
            .select()
            .from(followRequests)
            .where(and(eq(followRequests.senderId, followerId), eq(followRequests.recipientId, followingId)))
            .limit(1);

        res.json({
            isFollowing: !!follow,
            isRequested: !!request,
            followedAt: follow?.createdAt || null,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * @openapi
 * /api/v1/follows/stats/{userId}:
 *   get:
 *     tags: [Follows]
 *     summary: Get follow statistics for user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Follower/Following counts
 */
router.get('/stats/:userId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.userId;
        const [
            [{ followersCount }],
            [{ followingCount }]
        ] = await Promise.all([
            db.select({ followersCount: count() }).from(follows).where(eq(follows.followingId, userId)),
            db.select({ followingCount: count() }).from(follows).where(eq(follows.followerId, userId)),
        ]);
        res.json({ followersCount, followingCount });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

export default router;
