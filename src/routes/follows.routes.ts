import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { db } from '../db/index.js';
import { users, follows, followRequests, notifications } from '../db/schema.js';
import { eq, and, or, desc, count, ilike } from 'drizzle-orm';
import notificationService from '../services/notification.service.js';
import { formatUserWithAvatar, formatUsersWithAvatar } from '../utils/avatar.util.js';

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
            res.status(200).json({ message: 'Already following this user', status: 'following' });
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
                res.status(200).json({ message: 'Follow request already pending', status: 'requested' });
                return;
            }
            await db.delete(followRequests).where(eq(followRequests.id, existingRequest.id));
        }

        const [actor] = await db
            .select({ username: users.username, displayName: users.displayName, profilePictureUrl: users.profilePictureUrl })
            .from(users)
            .where(eq(users.id, followerId))
            .limit(1);
        const actorName = actor?.displayName || actor?.username || 'Someone';
        const actorAvatar = actor?.profilePictureUrl || null;

        // Check target user's privacy level
        const isPrivateAccount = userToFollow.privacyLevel === 'FOLLOWERS_ONLY' || 
                                 userToFollow.privacyLevel === 'PRIVATE' || 
                                 userToFollow.isPrivate === true;

        if (isPrivateAccount) {
            // Require approval for private accounts
            const [request] = await db
                .insert(followRequests)
                .values({ senderId: followerId, recipientId: followingId })
                .onConflictDoUpdate({
                    target: [followRequests.senderId, followRequests.recipientId],
                    set: { status: 'pending', createdAt: new Date() }
                })
                .returning();

            await notificationService.createNotification(followingId, 'FOLLOW_REQUEST', {
                actorId: followerId,
                actorName,
                actorAvatar,
                requestId: request.id
            });

            res.status(201).json({ message: 'Follow request sent', status: 'requested' });
        } else {
            // Direct instant follow for public accounts
            await db.insert(follows).values({ followerId, followingId }).onConflictDoNothing();

            await notificationService.createNotification(followingId, 'FOLLOW', {
                actorId: followerId,
                actorName,
                actorAvatar
            });

            res.status(201).json({ message: 'Followed user successfully', status: 'following' });
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

        let [request] = await db
            .select()
            .from(followRequests)
            .where(eq(followRequests.id, requestId))
            .limit(1);

        // Fallback: If requestId passed was the sender's user ID
        if (!request) {
            [request] = await db
                .select()
                .from(followRequests)
                .where(and(eq(followRequests.senderId, requestId), eq(followRequests.recipientId, userId)))
                .limit(1);
        }

        if (!request || request.recipientId !== userId) {
            res.status(404).json({ error: 'Request not found' });
            return;
        }

        await db.insert(follows).values({ followerId: request.senderId, followingId: userId }).onConflictDoNothing();
        await db.delete(followRequests).where(eq(followRequests.id, request.id));

        // Delete recipient's FOLLOW_REQUEST notifications from this sender
        const bNotifications = await db
            .select()
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.type, 'FOLLOW_REQUEST')
            ));

        const notifsToDelete = bNotifications.filter(n => {
            const content = n.content as any;
            return content && (content.requestId === request.id || content.requestId === requestId || content.actorId === request.senderId);
        });

        for (const notif of notifsToDelete) {
            await db.delete(notifications).where(eq(notifications.id, notif.id));
        }

        const [recipient] = await db
            .select({ username: users.username, displayName: users.displayName, profilePictureUrl: users.profilePictureUrl })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        await notificationService.createNotification(request.senderId, 'FOLLOW_ACCEPT', {
            actorId: userId,
            actorName: recipient?.displayName || recipient?.username || 'Someone',
            actorAvatar: recipient?.profilePictureUrl || null
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
 * */
router.post('/requests/:requestId/reject', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;
        const userId = req.user!.userId;

        let [request] = await db
            .select()
            .from(followRequests)
            .where(eq(followRequests.id, requestId))
            .limit(1);

        // Fallback: If requestId passed was the sender's user ID
        if (!request) {
            [request] = await db
                .select()
                .from(followRequests)
                .where(and(eq(followRequests.senderId, requestId), eq(followRequests.recipientId, userId)))
                .limit(1);
        }

        if (!request || request.recipientId !== userId) {
            res.status(404).json({ error: 'Request not found' });
            return;
        }

        const [recipient] = await db
            .select({ username: users.username, displayName: users.displayName, profilePictureUrl: users.profilePictureUrl })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        await db.delete(followRequests).where(eq(followRequests.id, request.id));

        // Delete recipient's FOLLOW_REQUEST notifications from this sender
        const bNotifications = await db
            .select()
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.type, 'FOLLOW_REQUEST')
            ));

        const notifsToDelete = bNotifications.filter(n => {
            const content = n.content as any;
            return content && (content.requestId === request.id || content.requestId === requestId || content.actorId === request.senderId);
        });

        for (const notif of notifsToDelete) {
            await db.delete(notifications).where(eq(notifications.id, notif.id));
        }

        await notificationService.createNotification(request.senderId, 'FOLLOW_REJECT', {
            actorId: userId,
            actorName: recipient?.displayName || recipient?.username || 'Someone',
            actorAvatar: recipient?.profilePictureUrl || null
        });

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

        const formattedRequests = requests.map(r => ({
            ...r,
            sender: formatUserWithAvatar(r.sender),
        }));

        res.json(formattedRequests);
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

        const deleteRequestResult = await db
            .delete(followRequests)
            .where(and(eq(followRequests.senderId, followerId), eq(followRequests.recipientId, followingId)))
            .returning();

        // Also clean up any FOLLOW_REQUEST notification from followerId to followingId
        const pendingNotifications = await db
            .select()
            .from(notifications)
            .where(and(
                eq(notifications.userId, followingId),
                eq(notifications.type, 'FOLLOW_REQUEST')
            ));

        const notifsToDelete = pendingNotifications.filter(n => {
            const content = n.content as any;
            return content && content.actorId === followerId;
        });

        for (const notif of notifsToDelete) {
            await db.delete(notifications).where(eq(notifications.id, notif.id));
        }

        const [existingFollow] = await db
            .select()
            .from(follows)
            .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
            .limit(1);

        if (!existingFollow) {
            if (deleteRequestResult.length > 0) {
                res.json({ message: 'Successfully canceled follow request' });
                return;
            }
            res.json({ message: 'Successfully unfollowed user' });
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
        const currentUserId = req.user!.userId;
        const page = parseInt(req.query.page as string, 10) || 1;
        const limit = parseInt(req.query.limit as string, 10) || 20;
        const offset = (page - 1) * limit;

        // Privacy check
        if (userId !== currentUserId) {
            const [targetUser] = await db
                .select({ isPrivate: users.isPrivate, privacyLevel: users.privacyLevel })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);

            if (!targetUser) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            const isPrivateAccount = targetUser.privacyLevel === 'FOLLOWERS_ONLY' || 
                                     targetUser.privacyLevel === 'PRIVATE' || 
                                     targetUser.isPrivate === true;

            if (isPrivateAccount) {
                const [followRecord] = await db
                    .select()
                    .from(follows)
                    .where(and(eq(follows.followerId, currentUserId), eq(follows.followingId, userId)))
                    .limit(1);

                if (!followRecord) {
                    res.status(403).json({ error: 'This profile is private. Follow to view followers list.' });
                    return;
                }
            }
        }

        const searchQ = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@/, '') : '';
        const whereClause = searchQ
            ? and(
                eq(follows.followingId, userId),
                or(
                    ilike(users.username, `%${searchQ}%`),
                    ilike(users.displayName, `%${searchQ}%`)
                )
            )
            : eq(follows.followingId, userId);

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
                .where(whereClause)
                .limit(limit)
                .offset(offset)
                .orderBy(desc(follows.createdAt)),
            db.select({ total: count() }).from(follows).innerJoin(users, eq(follows.followerId, users.id)).where(whereClause)
        ]);

        res.json({
            followers: formatUsersWithAvatar(followersList),
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
        const currentUserId = req.user!.userId;
        const page = parseInt(req.query.page as string, 10) || 1;
        const limit = parseInt(req.query.limit as string, 10) || 20;
        const offset = (page - 1) * limit;

        // Privacy check
        if (userId !== currentUserId) {
            const [targetUser] = await db
                .select({ isPrivate: users.isPrivate, privacyLevel: users.privacyLevel })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);

            if (!targetUser) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            const isPrivateAccount = targetUser.privacyLevel === 'FOLLOWERS_ONLY' || 
                                     targetUser.privacyLevel === 'PRIVATE' || 
                                     targetUser.isPrivate === true;

            if (isPrivateAccount) {
                const [followRecord] = await db
                    .select()
                    .from(follows)
                    .where(and(eq(follows.followerId, currentUserId), eq(follows.followingId, userId)))
                    .limit(1);

                if (!followRecord) {
                    res.status(403).json({ error: 'This profile is private. Follow to view following list.' });
                    return;
                }
            }
        }

        const searchQ = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@/, '') : '';
        const whereClause = searchQ
            ? and(
                eq(follows.followerId, userId),
                or(
                    ilike(users.username, `%${searchQ}%`),
                    ilike(users.displayName, `%${searchQ}%`)
                )
            )
            : eq(follows.followerId, userId);

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
                .where(whereClause)
                .limit(limit)
                .offset(offset)
                .orderBy(desc(follows.createdAt)),
            db.select({ total: count() }).from(follows).innerJoin(users, eq(follows.followingId, users.id)).where(whereClause)
        ]);

        res.json({
            following: formatUsersWithAvatar(followingList),
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
