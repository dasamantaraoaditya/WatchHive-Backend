import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../middleware/auth.middleware.js';

import { db } from '../db/index.js';
import { users, follows, entries } from '../db/schema.js';
import { eq, or, and, ilike, not, count, exists } from 'drizzle-orm';
import { AppError } from '../middleware/error.middleware.js';

import { S3Client, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import multerS3 from 'multer-s3';

const router = Router();

// Configure S3 client for Railway Buckets
const s3 = new S3Client({
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL, // Railway provides this
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true, // Often required for S3-compatible providers
});

// Helper to generate a presigned URL for an avatar
const getAvatarUrl = async (key: string | null): Promise<string | null> => {
    if (!key) return null;
    if (key.startsWith('http')) return key; // Already a full URL (legacy or external)

    try {
        const command = new GetObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: key,
        });
        // URL valid for 1 hour
        return await getSignedUrl(s3, command, { expiresIn: 3600 });
    } catch (err) {
        console.error('Error generating presigned URL:', err);
        return null;
    }
};

// Configure multer for Railway Bucket uploads
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.AWS_S3_BUCKET_NAME || 'watchhive-avatars',
        acl: 'private', // Railway buckets are private by default
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (req, _file, cb) => {
            const userId = req.user?.userId || 'unknown';
            const ext = path.extname(_file.originalname) || '.jpg';
            const filename = `avatars/${userId}-${Date.now()}${ext}`;
            cb(null, filename);
        },
    }),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB
    },
    fileFilter: (_req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new AppError('Only JPEG, PNG, WebP, and GIF images are allowed', 400) as any);
        }
    },
});


/**
 * @openapi
 * tags:
 *   name: User
 *   description: User profile and avatar management
 */

/**
 * @openapi
 * /api/v1/users/me:
 *   get:
 *     tags: [User]
 *     summary: Get current user profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile details
 */
router.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.userId;

        const [userResult] = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                displayName: users.displayName,
                bio: users.bio,
                profilePictureUrl: users.profilePictureUrl,
                location: users.location,
                isPrivate: users.isPrivate,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
                entriesCount: count(entries.id),
            })
            .from(users)
            .leftJoin(entries, eq(entries.userId, users.id))
            .where(eq(users.id, userId))
            .groupBy(users.id)
            .limit(1);

        if (!userResult) {
            throw new AppError('User not found', 404);
        }

        const user = {
            ...userResult,
            _count: {
                entries: Number(userResult.entriesCount),
                followers: 0, // Placeholder or fetch separately if needed
                following: 0,
            }
        };

        // Generate signed URL for avatar
        user.profilePictureUrl = await getAvatarUrl(user.profilePictureUrl);

        res.json(user);
    } catch (error) {
        next(error);
    }
});

/**
 * @openapi
 * /api/v1/users/me:
 *   put:
 *     tags: [User]
 *     summary: Update current user profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *               bio:
 *                 type: string
 *               location:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.put('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.userId;
        const { displayName, bio, location } = req.body;

        const [user] = await db
            .update(users)
            .set({
                ...(displayName !== undefined && { displayName }),
                ...(bio !== undefined && { bio }),
                ...(location !== undefined && { location }),
                updatedAt: new Date(),
            })
            .where(eq(users.id, userId))
            .returning({
                id: users.id,
                username: users.username,
                email: users.email,
                displayName: users.displayName,
                bio: users.bio,
                profilePictureUrl: users.profilePictureUrl,
                location: users.location,
                isPrivate: users.isPrivate,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            });

        if (user) {
            user.profilePictureUrl = await getAvatarUrl(user.profilePictureUrl);
        }

        res.json(user);
    } catch (error) {
        next(error);
    }
});

/**
 * @openapi
 * /api/v1/users/me/avatar:
 *   post:
 *     tags: [User]
 *     summary: Upload profile picture
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 */
router.post(
    '/me/avatar',
    authMiddleware,
    upload.single('avatar'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user!.userId;

            if (!req.file) {
                throw new AppError('No file uploaded', 400);
            }

            // Delete old avatar file if it exists
            const [currentUser] = await db
                .select({ profilePictureUrl: users.profilePictureUrl })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);

            if (currentUser?.profilePictureUrl && !currentUser.profilePictureUrl.startsWith('http')) {
                try {
                    await s3.send(new DeleteObjectCommand({
                        Bucket: process.env.AWS_S3_BUCKET_NAME || 'watchhive-avatars',
                        Key: currentUser.profilePictureUrl,
                    }));
                } catch (err: any) {
                    console.error('Error deleting old avatar from Bucket:', err);
                }
            }

            // Store the S3 Key in the database
            const profilePictureUrl = (req.file as any).key;

            if (!profilePictureUrl) {
                throw new AppError('File upload failed - storage key not generated', 500);
            }

            // Update user in database
            const [user] = await db
                .update(users)
                .set({ profilePictureUrl, updatedAt: new Date() })
                .where(eq(users.id, userId))
                .returning({
                    id: users.id,
                    username: users.username,
                    email: users.email,
                    displayName: users.displayName,
                    bio: users.bio,
                    profilePictureUrl: users.profilePictureUrl,
                    location: users.location,
                });

            if (user) {
                user.profilePictureUrl = await getAvatarUrl(user.profilePictureUrl);
            }

            res.json(user);
        } catch (error: any) {
            if (error.name === 'CredentialsProviderError' || error.message?.includes('credentials') || error.message?.includes('endpoint')) {
                console.error('CRITICAL: Railway Bucket credentials or endpoint missing.');
                return next(new AppError('Bucket storage not provisioned. Please contact support.', 500));
            }
            next(error);
        }
    }
);

/**
 * @openapi
 * /api/v1/users/me/avatar:
 *   delete:
 *     tags: [User]
 *     summary: Remove profile picture
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Avatar removed
 */
router.delete('/me/avatar', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.userId;

        // Get current avatar to delete file
        const [currentUser] = await db
            .select({ profilePictureUrl: users.profilePictureUrl })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (currentUser?.profilePictureUrl && !currentUser.profilePictureUrl.startsWith('http')) {
            try {
                await s3.send(new DeleteObjectCommand({
                    Bucket: process.env.AWS_S3_BUCKET_NAME || 'watchhive-avatars',
                    Key: currentUser.profilePictureUrl,
                }));
            } catch (err: any) {
                console.error('Error deleting avatar from Bucket:', err);
            }
        }

        // Clear profilePictureUrl in database
        const [user] = await db
            .update(users)
            .set({ profilePictureUrl: null, updatedAt: new Date() })
            .where(eq(users.id, userId))
            .returning({
                id: users.id,
                username: users.username,
                email: users.email,
                displayName: users.displayName,
                bio: users.bio,
                profilePictureUrl: users.profilePictureUrl,
                location: users.location,
            });

        res.json(user);
    } catch (error) {
        next(error);
    }
});


/**
 * @openapi
 * /api/v1/users/search:
 *   get:
 *     tags: [User]
 *     summary: Search for users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
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
 *         description: List of matching users
 */
router.get('/search', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = req.query.q as string;
        const page = parseInt(req.query.page as string, 10) || 1;
        const limit = parseInt(req.query.limit as string, 10) || 20;

        if (!query || query.trim().length === 0) {
            res.json({ users: [], pagination: { page, limit, total: 0, totalPages: 0 } });
            return;
        }

        const offset = (page - 1) * limit;
        const currentId = req.user!.userId;

        const whereClause = and(
            or(
                ilike(users.username, `%${query}%`),
                ilike(users.displayName, `%${query}%`)
            ),
            not(eq(users.id, currentId))
        );

        const [usersList, [{ total }]] = await Promise.all([
            db.select({
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                isPrivate: users.isPrivate,
                isFollowing: exists(
                    db.select()
                        .from(follows)
                        .where(and(eq(follows.followerId, currentId), eq(follows.followingId, users.id)))
                )
            })
                .from(users)
                .where(whereClause)
                .limit(limit)
                .offset(offset),
            db.select({ total: count() }).from(users).where(whereClause)
        ]);

        res.json({
            users: await Promise.all(usersList.map(async (u) => ({
                ...u,
                profilePictureUrl: await getAvatarUrl(u.profilePictureUrl)
            }))),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @openapi
 * /api/v1/users/suggested:
 *   get:
 *     tags: [User]
 *     summary: Get suggested users to follow
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of suggested users
 */
router.get('/suggested', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const currentId = req.user!.userId;
        const limit = 5;

        // Fetch users the current user is NOT following, excluding themselves
        // In PostgreSQL logic, we filter where NOT EXISTS in follows
        const whereClause = and(
            not(eq(users.id, currentId)),
            not(exists(
                db.select()
                    .from(follows)
                    .where(and(eq(follows.followerId, currentId), eq(follows.followingId, users.id)))
            ))
        );

        const usersList = await db.select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            profilePictureUrl: users.profilePictureUrl,
            bio: users.bio
        })
            .from(users)
            .where(whereClause)
            .limit(limit);

        res.json({
            users: await Promise.all(usersList.map(async (u) => ({
                ...u,
                profilePictureUrl: await getAvatarUrl(u.profilePictureUrl)
            })))
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @openapi
 * /api/v1/users/{id}:
 *   get:
 *     tags: [User]
 *     summary: Get specific user profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User profile details and stats
 *       404:
 *         description: User not found
 */
router.get('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const targetId = req.params.id;
        const currentId = req.user!.userId;

        // Fetch user basic info
        const [user] = await db
            .select({
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                bio: users.bio,
                profilePictureUrl: users.profilePictureUrl,
                location: users.location,
                isPrivate: users.isPrivate,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.id, targetId))
            .limit(1);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Fetch stats in parallel
        const [
            [{ followersCount }],
            [{ followingCount }],
            [{ entriesCount }],
            [followStatus]
        ] = await Promise.all([
            db.select({ followersCount: count() }).from(follows).where(eq(follows.followingId, targetId)),
            db.select({ followingCount: count() }).from(follows).where(eq(follows.followerId, targetId)),
            db.select({ entriesCount: count() }).from(entries).where(eq(entries.userId, targetId)),
            db.select().from(follows).where(and(eq(follows.followerId, currentId), eq(follows.followingId, targetId))).limit(1)
        ]);

        res.json({
            ...user,
            profilePictureUrl: await getAvatarUrl(user.profilePictureUrl),
            _count: {
                followers: followersCount,
                following: followingCount,
                entries: entriesCount
            },
            isFollowing: !!followStatus,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
