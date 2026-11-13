import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { db } from '../db/index.js';
import { users, entries, follows, likes, comments, followRequests, suggestions, blockedUsers } from '../db/schema.js';
import { eq, and, desc, asc, count, sql, ilike, or, arrayContains, avg, aliasedTable, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware.js';
import tmdbService from '../services/tmdb.service.js';
import { xpService, XpAction } from '../services/xp.service.js';
import { formatUserWithAvatar } from '../utils/avatar.util.js';
import notificationService from '../services/notification.service.js';
import { statsSummaryCache, invalidateUserCaches } from '../utils/cache.util.js';

const router = Router();

/**
 * Safely parse date inputs and guard against client timezone confusion / future timestamps.
 * Any entry timestamp cannot be in the future beyond server now (+ 1-minute grace for minor clock skew).
 */
function resolveValidDate(dateInput: any, defaultFallback: Date | null = new Date()): Date | null {
    if (!dateInput) return defaultFallback;
    const parsed = new Date(dateInput);
    if (isNaN(parsed.getTime())) return defaultFallback;
    const now = new Date();
    // Clamp future dates to now
    return parsed.getTime() > now.getTime() + 60000 ? now : parsed;
}

/**
 * Helper to dispatch friend watching activity notifications to followers
 */
async function notifyFollowersOfActivity(params: {
    actorId: string;
    actorName: string;
    actorAvatar?: string | null;
    entryId: string;
    entryTitle: string;
    mediaType?: string;
    rating?: number | null;
    review?: string | null;
    isWatching: boolean;
    tmdbId?: number | null;
}) {
    try {
        const userFollowers = await db
            .select({ followerId: follows.followerId })
            .from(follows)
            .where(eq(follows.followingId, params.actorId));

        if (!userFollowers || userFollowers.length === 0) return;

        const notifType = params.isWatching ? 'FRIEND_STARTED_WATCHING' : 'FRIEND_LOGGED_WATCH';
        const notifContent = {
            actorId: params.actorId,
            actorName: params.actorName,
            actorAvatar: params.actorAvatar || null,
            entryId: params.entryId,
            entryTitle: params.entryTitle,
            title: params.entryTitle,
            type: params.mediaType || 'MOVIE',
            mediaType: (params.mediaType || '').toLowerCase().includes('tv') ? 'tv' : 'movie',
            rating: params.rating ?? null,
            review: params.review ? params.review.slice(0, 100) : null,
            isWatching: params.isWatching,
            tmdbId: params.tmdbId ?? null,
        };

        await Promise.allSettled(
            userFollowers.map(f =>
                notificationService.createNotification(f.followerId, notifType, notifContent)
            )
        );
    } catch (err) {
        console.error('[Notification] Error dispatching follower activity notifications:', err);
    }
}

// Validation middleware
const validateEntry = [
    body('tmdbId').isInt().withMessage('TMDb ID must be an integer'),
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 255 }).withMessage('Title cannot exceed 255 characters'),
    body('type').isIn(['MOVIE', 'TV_SHOW', 'EPISODE']).withMessage('Invalid entry type'),
    body('watchedAt').optional({ nullable: true }).isISO8601().withMessage('Invalid date format'),
    body('rating').optional({ nullable: true }).isFloat({ min: 0, max: 10 }).withMessage('Rating must be between 0 and 10'),
    body('review').optional({ nullable: true }).trim().isLength({ max: 5000 }).withMessage('Review cannot exceed 5000 characters'),
    body('tags').optional({ nullable: true }).isArray({ max: 20 }).withMessage('Tags must be an array with max 20 items'),
    body('isRewatch').optional({ nullable: true }).isBoolean().withMessage('isRewatch must be boolean'),
    body('isWatching').optional({ nullable: true }).isBoolean().withMessage('isWatching must be boolean'),
    body('startedAt').optional({ nullable: true }).isISO8601().withMessage('Invalid date format'),
    body('completedAt').optional({ nullable: true }).isISO8601().withMessage('Invalid date format'),
    body('watchLocation').optional({ nullable: true }).trim().isLength({ max: 100 }).withMessage('Watch location cannot exceed 100 characters'),
    body('postToFeed').optional({ nullable: true }).isBoolean().withMessage('postToFeed must be boolean'),
    body('currentSeason').optional({ nullable: true }).isInt({ min: 0 }).withMessage('currentSeason must be a positive integer'),
    body('currentEpisode').optional({ nullable: true }).isInt({ min: 0 }).withMessage('currentEpisode must be a positive integer'),
];

/**
 * @openapi
 * tags:
 *   name: Entries
 *   description: Watch logs and entries management
 */

/**
 * @openapi
 * /api/v1/entries:
 *   post:
 *     tags: [Entries]
 *     summary: Create a new watch entry
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tmdbId
 *               - title
 *               - type
 *             properties:
 *               tmdbId:
 *                 type: integer
 *               title:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [MOVIE, TV_SHOW, EPISODE]
 *               watchedAt:
 *                 type: string
 *                 format: date-time
 *               rating:
 *                 type: number
 *                 format: float
 *                 minimum: 0
 *                 maximum: 10
 *               review:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               isRewatch:
 *                 type: boolean
 *               watchLocation:
 *                 type: string
 *     responses:
 *       201:
 *         description: Entry created successfully
 */
router.post(
    '/',
    authMiddleware,
    validateEntry,
    async (req: Request, res: Response): Promise<any> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ errors: errors.array() });
                return;
            }

            // Gating: Require email verification before logging movies
            if ((req as any).user?.isEmailVerified === false) {
                res.status(403).json({
                    error: 'Please verify your email address before logging movies.',
                    code: 'email_verification_required',
                });
                return;
            }

            const userId = (req as any).user.userId;
            const {
                tmdbId,
                title,
                type,
                watchedAt,
                rating,
                review,
                tags,
                isRewatch,
                isWatching,
                startedAt,
                completedAt,
                watchLocation,
                suggestedByUserId,
                posterPath,
                backdropPath,
                postToFeed,
                currentSeason,
                currentEpisode,
            } = req.body;

            const resolvedCurrentSeason = currentSeason !== undefined && currentSeason !== null ? Number(currentSeason) : null;
            const resolvedCurrentEpisode = currentEpisode !== undefined && currentEpisode !== null ? Number(currentEpisode) : null;

            const isEntryPostedToFeed = postToFeed !== undefined ? Boolean(postToFeed) : true;

            let finalSuggestedByUserId = suggestedByUserId || null;
            if (!finalSuggestedByUserId && tmdbId) {
                const [matchingSuggestion] = await db
                    .select({ fromUserId: suggestions.fromUserId })
                    .from(suggestions)
                    .where(and(eq(suggestions.toUserId, userId), eq(suggestions.tmdbId, tmdbId)))
                    .orderBy(desc(suggestions.createdAt))
                    .limit(1);
                if (matchingSuggestion) {
                    finalSuggestedByUserId = matchingSuggestion.fromUserId;
                }
            }

            let entryTags: string[] = Array.isArray(tags) ? [...tags] : [];
            let resolvedTitle: string = title ? title.trim() : '';
            let tmdbPoster: string | null = null;
            let tmdbBackdrop: string | null = null;

            if (tmdbId) {
                try {
                    let genres: string[] = [];
                    let tmdbTitle: string | null = null;
                    if (type === 'MOVIE') {
                        const details = await tmdbService.getMovieDetails(tmdbId);
                        genres = details.genres.map(g => g.name);
                        tmdbTitle = details.title || (details as any).original_title || null;
                        tmdbPoster = details.poster_path;
                        tmdbBackdrop = details.backdrop_path;
                    } else if (type === 'TV_SHOW') {
                        const details = await tmdbService.getTVShowDetails(tmdbId);
                        genres = details.genres.map(g => g.name);
                        tmdbTitle = (details as any).name || (details as any).original_name || null;
                        tmdbPoster = details.poster_path;
                        tmdbBackdrop = details.backdrop_path;
                    }
                    // Merge and deduplicate
                    entryTags = Array.from(new Set([...entryTags, ...genres]));

                    // If title is missing, generic, or 'this title' / 'untitled', override with verified TMDB title
                    const isGeneric = !resolvedTitle ||
                        resolvedTitle.toLowerCase() === 'this title' ||
                        resolvedTitle.toLowerCase() === 'untitled' ||
                        resolvedTitle.toLowerCase().startsWith('movie #') ||
                        resolvedTitle.toLowerCase().startsWith('media #');
                    if (isGeneric && tmdbTitle) {
                        resolvedTitle = tmdbTitle;
                    }
                } catch (tmdbError) {
                    console.error('Failed to auto-fetch TMDB details', tmdbError);
                }
            }

            if (!resolvedTitle) {
                resolvedTitle = 'Untitled';
            }

            let targetEntryId: string | null = null;

            if (tmdbId) {
                // Fetch existing entries for this user and title
                const existingEntriesList = await db
                    .select()
                    .from(entries)
                    .where(and(eq(entries.userId, userId), eq(entries.tmdbId, tmdbId)));

                // Prefer updating an active currently-watching entry or an unrated placeholder
                const activeWatchingEntry = existingEntriesList.find(e => {
                    if (!e.isWatching) return false;
                    if (type === 'TV_SHOW' && resolvedCurrentSeason !== null) {
                        return e.currentSeason === resolvedCurrentSeason || e.currentSeason === null;
                    }
                    return true;
                });
                const placeholderEntry = existingEntriesList.find(e => {
                    if (e.rating !== null || e.review) return false;
                    if (type === 'TV_SHOW' && resolvedCurrentSeason !== null) {
                        return e.currentSeason === resolvedCurrentSeason || e.currentSeason === null;
                    }
                    return true;
                });
                const targetExisting = activeWatchingEntry || placeholderEntry;

                // Check if user already has a completed watch entry for this title (or season)
                const completedWatch = existingEntriesList.find(e => {
                    if (e.isWatching || (e.rating === null && e.review === null && e.completedAt === null)) {
                        return false;
                    }
                    if (type === 'TV_SHOW' && resolvedCurrentSeason !== null) {
                        // Season-aware: only treat as duplicate if the exact same season was already completed
                        return e.currentSeason === resolvedCurrentSeason;
                    }
                    return true;
                });

                // If user has already watched this title, and this submission is a completed entry without isRewatch,
                // do not allow standard duplicate logging
                if (completedWatch && !targetExisting && !isWatching && !isRewatch) {
                    res.status(400).json({
                        error: type === 'TV_SHOW' && resolvedCurrentSeason !== null
                            ? `You have already watched Season ${resolvedCurrentSeason}. Rewatch must be enabled to log a duplicate entry.`
                            : 'You have already watched this title. Rewatch must be enabled to log a duplicate entry.',
                        code: 'ALREADY_WATCHED',
                        existingEntry: {
                            ...completedWatch,
                            rating: completedWatch.rating ? parseFloat(completedWatch.rating) : null,
                        }
                    });
                    return;
                }

                const isDateOmitted = watchedAt === null || watchedAt === '' || req.body.unspecifiedDate === true;
                if (targetExisting && (!isWatching || rating || review)) {
                    const finalIsWatching = isWatching !== undefined ? isWatching : false;
                    const now = new Date();
                    const resolvedWatchedAt = isDateOmitted ? null : (watchedAt !== undefined ? resolveValidDate(watchedAt, now) : targetExisting.watchedAt);
                    await db
                        .update(entries)
                        .set({
                            title: resolvedTitle,
                            type: type as any,
                            watchedAt: resolvedWatchedAt,
                            rating: rating ? rating.toString() : targetExisting.rating,
                            review: review !== undefined ? (review || null) : targetExisting.review,
                            tags: entryTags.length > 0 ? entryTags : targetExisting.tags,
                            isRewatch: isRewatch !== undefined ? isRewatch : targetExisting.isRewatch,
                            isWatching: finalIsWatching,
                            completedAt: !finalIsWatching ? resolveValidDate(completedAt, now) : null,
                            watchLocation: watchLocation !== undefined ? (watchLocation || null) : targetExisting.watchLocation,
                            suggestedByUserId: finalSuggestedByUserId || targetExisting.suggestedByUserId,
                            posterPath: posterPath || tmdbPoster || targetExisting.posterPath,
                            backdropPath: backdropPath || tmdbBackdrop || targetExisting.backdropPath,
                            postToFeed: postToFeed !== undefined ? Boolean(postToFeed) : targetExisting.postToFeed,
                            currentSeason: resolvedCurrentSeason !== null ? resolvedCurrentSeason : targetExisting.currentSeason,
                            currentEpisode: resolvedCurrentEpisode !== null ? resolvedCurrentEpisode : targetExisting.currentEpisode,
                            updatedAt: now,
                        })
                        .where(eq(entries.id, targetExisting.id));

                    targetEntryId = targetExisting.id;

                    // Clean up any remaining duplicate empty/watching placeholder entries for this title/season
                    for (const dup of existingEntriesList) {
                        const isSameScope = type !== 'TV_SHOW' || resolvedCurrentSeason === null || dup.currentSeason === resolvedCurrentSeason || dup.currentSeason === null;
                        if (dup.id !== targetExisting.id && isSameScope && (dup.isWatching || (dup.rating === null && !dup.review))) {
                            await db.delete(entries).where(eq(entries.id, dup.id));
                        }
                    }
                }
            }

            if (!targetEntryId) {
                // Create entry
                const now = new Date();
                const isDateOmitted = watchedAt === null || watchedAt === '' || req.body.unspecifiedDate === true;
                const resolvedWatchedAt = isDateOmitted ? null : (watchedAt !== undefined ? resolveValidDate(watchedAt, now) : now);
                const [newEntry] = await db.insert(entries).values({
                    userId,
                    tmdbId,
                    title: resolvedTitle,
                    type: type as any,
                    watchedAt: resolvedWatchedAt,
                    rating: rating ? rating.toString() : null,
                    review: review || null,
                    tags: entryTags,
                    isRewatch: isRewatch || false,
                    isWatching: isWatching || false,
                    startedAt: isWatching ? resolveValidDate(startedAt, now) : (startedAt ? resolveValidDate(startedAt, null) : null),
                    completedAt: !isWatching ? resolveValidDate(completedAt, now) : (completedAt ? resolveValidDate(completedAt, null) : null),
                    watchLocation: watchLocation || null,
                    suggestedByUserId: finalSuggestedByUserId,
                    posterPath: posterPath || tmdbPoster || null,
                    backdropPath: backdropPath || tmdbBackdrop || null,
                    postToFeed: isEntryPostedToFeed,
                    currentSeason: resolvedCurrentSeason,
                    currentEpisode: resolvedCurrentEpisode,
                }).returning();
                targetEntryId = newEntry.id;
            }

            // Fetch fully populated entry for response
            const entry = await db.query.entries.findFirst({
                where: eq(entries.id, targetEntryId),
                with: {
                    user: {
                        columns: {
                            id: true,
                            username: true,
                            displayName: true,
                            profilePictureUrl: true,
                        }
                    },
                    suggestedByUser: {
                        columns: {
                            id: true,
                            username: true,
                            displayName: true,
                            profilePictureUrl: true,
                        }
                    }
                }
            });

            // Need to manually add counts due to Drizzle _count limitation in findFirst
            const [[{ likesCount }], [{ commentsCount }]] = await Promise.all([
                db.select({ likesCount: count() }).from(likes).where(eq(likes.entryId, targetEntryId!)),
                db.select({ commentsCount: count() }).from(comments).where(eq(comments.entryId, targetEntryId!))
            ]);

            // Award XP to the user
            await xpService.awardXp(userId, XpAction.LOG_WATCH);
            // Award additional XP if they wrote a review
            if (review && review.trim().length > 10) {
                await xpService.awardXp(userId, XpAction.WRITE_REVIEW);
            }

            // Update watch streak and award streak badges
            await xpService.updateStreakAndCheckBadges(userId);

            // If entry was from a suggestion, mark suggestion as watched and award suggestion badges
            if (finalSuggestedByUserId) {
                try {
                    await db.update(suggestions)
                        .set({ status: 'watched' })
                        .where(and(eq(suggestions.toUserId, userId), eq(suggestions.tmdbId, tmdbId)));
                    await xpService.awardXp(userId, XpAction.COMPLETE_SUGGESTION);
                    await xpService.checkSuggestionBadges(userId);
                } catch (suggErr) {
                    console.error('[Entries] Error resolving suggestion on watch log:', suggErr);
                }
            }

            // Notify followers about watching activity (fire & forget) if allowed to post to feed
            if (isEntryPostedToFeed) {
                const actorName = entry?.user?.displayName || entry?.user?.username || 'Someone';
                const actorAvatar = entry?.user?.profilePictureUrl || null;
                notifyFollowersOfActivity({
                    actorId: userId,
                    actorName,
                    actorAvatar,
                    entryId: targetEntryId,
                    entryTitle: resolvedTitle,
                    mediaType: type,
                    rating: rating ? Number(rating) : null,
                    review: review || null,
                    isWatching: Boolean(isWatching),
                    tmdbId: tmdbId ? Number(tmdbId) : null,
                }).catch(err => console.error('[FollowerActivity] Notification error on create:', err));
            }

            invalidateUserCaches(userId);

            res.status(201).json({
                message: 'Entry created successfully',
                entry: {
                    ...entry,
                    user: entry?.user ? formatUserWithAvatar(entry.user) : entry?.user,
                    suggestedByUser: entry?.suggestedByUser ? formatUserWithAvatar(entry.suggestedByUser) : null,
                    _count: { likes: likesCount, comments: commentsCount }
                },
            });
        } catch (error) {
            console.error('Create entry error:', error);
            res.status(500).json({ error: 'Failed to create entry' });
        }
    }
);

/**
 * @openapi
 * /api/v1/entries:
 *   get:
 *     tags: [Entries]
 *     summary: Get all entries with filters
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [MOVIE, TV_SHOW, EPISODE]
 *       - in: query
 *         name: rating
 *         schema:
 *           type: integer
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of entries
 *       403:
 *         description: Account is private
 */
router.get('/', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        const currentUserId = (req as any).user.userId;
        const {
            type,
            rating,
            tag,
            search,
            limit = '20',
            offset = '0',
            sortBy = 'watchedAt',
            order = 'desc',
            isWatching: queryIsWatching,
            userId: queryUserId,
            tmdbId: queryTmdbId,
        } = req.query;

        let targetUserId = currentUserId;

        // If querying another user, check privacy permissions
        if (queryUserId && queryUserId !== currentUserId) {
            targetUserId = queryUserId as string;

            const [targetUser] = await db
                .select({ 
                    isPrivate: users.isPrivate,
                    privacyLevel: users.privacyLevel 
                })
                .from(users)
                .where(eq(users.id, targetUserId))
                .limit(1);

            if (!targetUser) {
                return res.status(404).json({ error: 'User not found' });
            }

            // New Tiered Privacy Logic
            if (targetUser.privacyLevel === 'PRIVATE') {
                return res.status(403).json({ error: 'This account is strictly private.' });
            }

            // Check if there is a pending follow request
            const [pendingRequest] = await db
                .select()
                .from(followRequests)
                .where(and(
                    eq(followRequests.senderId, currentUserId),
                    eq(followRequests.recipientId, targetUserId),
                    eq(followRequests.status, 'pending')
                ))
                .limit(1);

            if (pendingRequest) {
                return res.status(403).json({ error: 'Follow request is pending. Cannot view entries.' });
            }

            if (targetUser.privacyLevel === 'FOLLOWERS_ONLY' || targetUser.isPrivate) {
                const [isFollowing] = await db
                    .select()
                    .from(follows)
                    .where(and(eq(follows.followerId, currentUserId), eq(follows.followingId, targetUserId)))
                    .limit(1);

                if (!isFollowing) {
                    return res.status(403).json({ error: 'This account is private. Follow to see entries.' });
                }
            }
        }

        // Build filter conditions
        const conditions: any[] = [eq(entries.userId, targetUserId)];

        if (type) conditions.push(eq(entries.type, type as any));
        if (rating) conditions.push(eq(entries.rating, rating.toString()));
        if (tag) conditions.push(arrayContains(entries.tags, [tag as string]));
        if (queryIsWatching !== undefined) {
            conditions.push(eq(entries.isWatching, queryIsWatching === 'true'));
        }
        if (queryTmdbId !== undefined) {
            const parsedTmdbId = parseInt(queryTmdbId as string, 10);
            if (!isNaN(parsedTmdbId)) {
                conditions.push(eq(entries.tmdbId, parsedTmdbId));
            }
        }
        if (search) {
            conditions.push(or(
                ilike(entries.title, `%${search}%`),
                ilike(entries.review, `%${search}%`)
            ));
        }

        const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

        // Whitelist allowed sort fields and sort directions
        const ALLOWED_SORT_FIELDS: Record<string, any> = {
            watchedAt: sql`COALESCE(${entries.watchedAt}, ${entries.createdAt})`,
            createdAt: entries.createdAt,
            rating: entries.rating,
            title: entries.title,
        };
        const sortColumn = ALLOWED_SORT_FIELDS[sortBy as string] || sql`COALESCE(${entries.watchedAt}, ${entries.createdAt})`;
        const sortOrder = String(order).toLowerCase() === 'asc' ? asc(sortColumn) : desc(sortColumn);

        // Sanitize limit and offset
        const safeLimit = Math.min(Math.max(parseInt(limit as string, 10) || 20, 1), 100);
        const safeOffset = Math.max(parseInt(offset as string, 10) || 0, 0);

        const suggestor = aliasedTable(users, 'suggestor');

        // Get entries with pagination and manual counts
        const [entriesList, [{ total }]] = await Promise.all([
            db.select({
                id: entries.id,
                userId: entries.userId,
                suggestedByUserId: entries.suggestedByUserId,
                tmdbId: entries.tmdbId,
                title: entries.title,
                type: entries.type,
                watchedAt: entries.watchedAt,
                rating: entries.rating,
                review: entries.review,
                tags: entries.tags,
                isRewatch: entries.isRewatch,
                isWatching: entries.isWatching,
                startedAt: entries.startedAt,
                completedAt: entries.completedAt,
                watchLocation: entries.watchLocation,
                createdAt: entries.createdAt,
                updatedAt: entries.updatedAt,
                posterPath: entries.posterPath,
                backdropPath: entries.backdropPath,
                currentSeason: entries.currentSeason,
                currentEpisode: entries.currentEpisode,
                totalEpisodesWatched: entries.totalEpisodesWatched,
                totalEpisodesCount: entries.totalEpisodesCount,
                user: {
                    id: users.id,
                    username: users.username,
                    displayName: users.displayName,
                    profilePictureUrl: users.profilePictureUrl
                },
                suggestedByUser: {
                    id: suggestor.id,
                    username: suggestor.username,
                    displayName: suggestor.displayName,
                    profilePictureUrl: suggestor.profilePictureUrl
                },
                likesCount: sql<number>`(SELECT count(*) FROM likes WHERE likes.entry_id = ${entries.id})`.mapWith(Number),
                commentsCount: sql<number>`(SELECT count(*) FROM comments WHERE comments.entry_id = ${entries.id})`.mapWith(Number)
            })
                .from(entries)
                .innerJoin(users, eq(entries.userId, users.id))
                .leftJoin(suggestor, eq(entries.suggestedByUserId, suggestor.id))
                .where(whereClause)
                .orderBy(sortOrder)
                .limit(safeLimit)
                .offset(safeOffset),
            db.select({ total: count() }).from(entries).where(whereClause)
        ]);


        // Map Drizzle result to Prisma-like structure for frontend compatibility
        const formattedEntries = (entriesList as any[]).map(e => ({
            ...e,
            rating: e.rating ? parseFloat(e.rating) : null,
            user: e.user ? formatUserWithAvatar(e.user) : e.user,
            suggestedByUser: e.suggestedByUser && e.suggestedByUser.id ? formatUserWithAvatar(e.suggestedByUser) : null,
            _count: {
                likes: e.likesCount,
                comments: e.commentsCount
            }
        }));

        // Deduplicate entries for the same user & tmdbId if duplicate entries exist from past testing
        const deduplicatedEntries = formattedEntries.filter((e, _idx, arr) => {
            if (!e.tmdbId) return true;
            const sameTmdbEntries = arr.filter(item => item.tmdbId === e.tmdbId && item.userId === e.userId);
            if (sameTmdbEntries.length > 1) {
                const hasRatedVersion = sameTmdbEntries.some(item => item.id !== e.id && (item.rating != null || (item.review && item.review.trim().length > 0)));
                if (e.rating == null && (!e.review || e.review.trim().length === 0) && hasRatedVersion) {
                    return false;
                }
            }
            return true;
        });

        res.json({
            entries: deduplicatedEntries,
            pagination: {
                total,
                limit: safeLimit,
                offset: safeOffset,
                hasMore: safeOffset + entriesList.length < total,
            },
        });
    } catch (error) {
        console.error('Get entries error:', error);
        res.status(500).json({ error: 'Failed to fetch entries' });
    }
});

/**
 * @openapi
 * /api/v1/entries/{id}:
 *   get:
 *     tags: [Entries]
 *     summary: Get a single watch entry
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
 *         description: Watch entry details
 *       404:
 *         description: Entry not found
 */
/**
 * @openapi
 * /api/v1/entries/check/{tmdbId}:
 *   get:
 *     tags: [Entries]
 *     summary: Check if user has already logged a completed watch for this title
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tmdbId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Check result with hasWatched and previous entry
 */
router.get(
    '/check/:tmdbId',
    authMiddleware,
    async (req: Request, res: Response): Promise<any> => {
        try {
            const userId = (req as any).user.userId || (req as any).user.id;
            const tmdbId = parseInt(req.params.tmdbId, 10);
            if (isNaN(tmdbId)) {
                res.status(400).json({ error: 'Invalid TMDb ID' });
                return;
            }

            const existingEntries = await db
                .select()
                .from(entries)
                .where(and(eq(entries.userId, userId), eq(entries.tmdbId, tmdbId)))
                .orderBy(desc(sql`COALESCE(${entries.watchedAt}, ${entries.createdAt})`), desc(entries.createdAt));

            const seasonQuery = req.query.season !== undefined ? parseInt(req.query.season as string, 10) : null;
            const completed = existingEntries.filter(
                e => !e.isWatching && (e.rating !== null || e.review !== null || e.completedAt !== null) &&
                     (seasonQuery === null || isNaN(seasonQuery) || e.currentSeason === seasonQuery)
            );

            if (completed.length > 0) {
                const latest = completed[0];
                res.json({
                    hasWatched: true,
                    watchCount: completed.length,
                    existingEntry: {
                        ...latest,
                        rating: latest.rating ? parseFloat(latest.rating) : null,
                    }
                });
                return;
            }

            res.json({
                hasWatched: false,
                watchCount: 0,
                existingEntry: null
            });
        } catch (error) {
            console.error('Failed to check existing entry:', error);
            res.status(500).json({ error: 'Failed to check entry' });
        }
    }
);

/**
 * @openapi
 * /api/v1/entries/media/{tmdbId}/social:
 *   get:
 *     tags: [Entries]
 *     summary: Get current user entry and followed friends reviews for a specific movie or show
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tmdbId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Social entries including userEntry and friendsEntries
 */
router.get(
    '/media/:tmdbId/social',
    authMiddleware,
    async (req: Request, res: Response): Promise<any> => {
        try {
            const currentUserId = (req as any).user.userId || (req as any).user.id;
            const tmdbId = parseInt(req.params.tmdbId, 10);
            if (isNaN(tmdbId)) {
                return res.status(400).json({ error: 'Invalid TMDb ID' });
            }

            const suggestor = aliasedTable(users, 'suggestor');

            // 1. Fetch current user's entry (or entries) for this tmdbId
            const userEntriesList = await db.select({
                id: entries.id,
                userId: entries.userId,
                suggestedByUserId: entries.suggestedByUserId,
                tmdbId: entries.tmdbId,
                title: entries.title,
                type: entries.type,
                watchedAt: entries.watchedAt,
                rating: entries.rating,
                review: entries.review,
                tags: entries.tags,
                isRewatch: entries.isRewatch,
                isWatching: entries.isWatching,
                startedAt: entries.startedAt,
                completedAt: entries.completedAt,
                watchLocation: entries.watchLocation,
                createdAt: entries.createdAt,
                updatedAt: entries.updatedAt,
                posterPath: entries.posterPath,
                backdropPath: entries.backdropPath,
                currentSeason: entries.currentSeason,
                currentEpisode: entries.currentEpisode,
                totalEpisodesWatched: entries.totalEpisodesWatched,
                totalEpisodesCount: entries.totalEpisodesCount,
                user: {
                    id: users.id,
                    username: users.username,
                    displayName: users.displayName,
                    profilePictureUrl: users.profilePictureUrl
                },
                suggestedByUser: {
                    id: suggestor.id,
                    username: suggestor.username,
                    displayName: suggestor.displayName,
                    profilePictureUrl: suggestor.profilePictureUrl
                },
                likesCount: sql<number>`(SELECT count(*) FROM likes WHERE likes.entry_id = ${entries.id})`.mapWith(Number),
                commentsCount: sql<number>`(SELECT count(*) FROM comments WHERE comments.entry_id = ${entries.id})`.mapWith(Number)
            })
            .from(entries)
            .innerJoin(users, eq(entries.userId, users.id))
            .leftJoin(suggestor, eq(entries.suggestedByUserId, suggestor.id))
            .where(and(eq(entries.userId, currentUserId), eq(entries.tmdbId, tmdbId)))
            .orderBy(desc(sql`COALESCE(${entries.watchedAt}, ${entries.createdAt})`), desc(entries.createdAt));

            let userEntry: any = null;
            const typedUserEntries = userEntriesList as any[];
            if (typedUserEntries.length > 0) {
                const completed = typedUserEntries.find(e => !e.isWatching && (e.rating !== null || e.review !== null));
                const rawEntry = completed || typedUserEntries[0];
                userEntry = {
                    ...rawEntry,
                    rating: rawEntry.rating ? parseFloat(rawEntry.rating) : null,
                    user: rawEntry.user ? formatUserWithAvatar(rawEntry.user) : rawEntry.user,
                    suggestedByUser: rawEntry.suggestedByUser && rawEntry.suggestedByUser.id ? formatUserWithAvatar(rawEntry.suggestedByUser) : null,
                    _count: {
                        likes: rawEntry.likesCount,
                        comments: rawEntry.commentsCount
                    }
                };
            }

            // 2. Fetch friends (followed users)
            const [followList, blocks] = await Promise.all([
                db.select({ followingId: follows.followingId })
                    .from(follows)
                    .where(eq(follows.followerId, currentUserId)),
                db.select({
                    blockerId: blockedUsers.blockerId,
                    blockedId: blockedUsers.blockedId,
                })
                .from(blockedUsers)
                .where(
                    or(
                        eq(blockedUsers.blockerId, currentUserId),
                        eq(blockedUsers.blockedId, currentUserId)
                    )
                )
            ]);

            const blockedSet = new Set<string>();
            blocks.forEach(b => {
                if (b.blockerId === currentUserId) blockedSet.add(b.blockedId);
                if (b.blockedId === currentUserId) blockedSet.add(b.blockerId);
            });

            const followedIds = followList
                .map(f => f.followingId)
                .filter(id => !blockedSet.has(id));

            let friendsEntries: any[] = [];
            if (followedIds.length > 0) {
                const rawFriendsEntries = await db.select({
                    id: entries.id,
                    userId: entries.userId,
                    suggestedByUserId: entries.suggestedByUserId,
                    tmdbId: entries.tmdbId,
                    title: entries.title,
                    type: entries.type,
                    watchedAt: entries.watchedAt,
                    rating: entries.rating,
                    review: entries.review,
                    tags: entries.tags,
                    isRewatch: entries.isRewatch,
                    isWatching: entries.isWatching,
                    startedAt: entries.startedAt,
                    completedAt: entries.completedAt,
                    watchLocation: entries.watchLocation,
                    createdAt: entries.createdAt,
                    updatedAt: entries.updatedAt,
                    posterPath: entries.posterPath,
                    backdropPath: entries.backdropPath,
                    currentSeason: entries.currentSeason,
                    currentEpisode: entries.currentEpisode,
                    totalEpisodesWatched: entries.totalEpisodesWatched,
                    totalEpisodesCount: entries.totalEpisodesCount,
                    user: {
                        id: users.id,
                        username: users.username,
                        displayName: users.displayName,
                        profilePictureUrl: users.profilePictureUrl,
                        privacyLevel: users.privacyLevel,
                        isPrivate: users.isPrivate,
                    },
                    suggestedByUser: {
                        id: suggestor.id,
                        username: suggestor.username,
                        displayName: suggestor.displayName,
                        profilePictureUrl: suggestor.profilePictureUrl
                    },
                    likesCount: sql<number>`(SELECT count(*) FROM likes WHERE likes.entry_id = ${entries.id})`.mapWith(Number),
                    commentsCount: sql<number>`(SELECT count(*) FROM comments WHERE comments.entry_id = ${entries.id})`.mapWith(Number),
                    isLiked: sql<boolean>`EXISTS (SELECT 1 FROM likes WHERE likes.entry_id = ${entries.id} AND likes.user_id = ${currentUserId})`.mapWith(Boolean)
                })
                .from(entries)
                .innerJoin(users, eq(entries.userId, users.id))
                .leftJoin(suggestor, eq(entries.suggestedByUserId, suggestor.id))
                .where(and(
                    inArray(entries.userId, followedIds),
                    eq(entries.tmdbId, tmdbId)
                ))
                .orderBy(desc(sql`COALESCE(${entries.watchedAt}, ${entries.createdAt})`), desc(entries.createdAt));

                const seenFriendIds = new Set<string>();
                const typedFriendsEntries = rawFriendsEntries as any[];
                for (const item of typedFriendsEntries) {
                    if (item.user.privacyLevel === 'PRIVATE') continue;
                    if (seenFriendIds.has(item.userId)) continue;
                    seenFriendIds.add(item.userId);

                    friendsEntries.push({
                        ...item,
                        rating: item.rating ? parseFloat(item.rating) : null,
                        user: formatUserWithAvatar(item.user),
                        suggestedByUser: item.suggestedByUser && item.suggestedByUser.id ? formatUserWithAvatar(item.suggestedByUser) : null,
                        isLiked: item.isLiked,
                        _count: {
                            likes: item.likesCount,
                            comments: item.commentsCount
                        }
                    });
                }
            }

            res.json({
                userEntry,
                friendsEntries
            });
        } catch (error) {
            console.error('Failed to get media social entries:', error);
            res.status(500).json({ error: 'Failed to fetch media social entries' });
        }
    }
);

/**
 * @openapi
 * /api/v1/entries/stats/summary:
 *   get:
 *     tags: [Entries]
 *     summary: Get user watch statistics summary
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User statistics summary
 */
router.get('/stats/summary', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user.userId;

        const cached = statsSummaryCache.get(userId);
        if (cached) {
            res.json({ stats: cached });
            return;
        }

        const [statsRow] = await db
            .select({
                totalEntries: count(),
                movieCount: sql<number>`count(*) filter (where ${entries.type} = 'MOVIE')`.mapWith(Number),
                tvShowCount: sql<number>`count(*) filter (where ${entries.type} = 'TV_SHOW')`.mapWith(Number),
                avgRating: avg(entries.rating),
            })
            .from(entries)
            .where(eq(entries.userId, userId));

        const totalEntries = statsRow?.totalEntries ?? 0;
        const movieCount = statsRow?.movieCount ?? 0;
        const tvShowCount = statsRow?.tvShowCount ?? 0;
        const avgRating = statsRow?.avgRating;

        const stats = {
            totalEntries,
            movieCount,
            tvShowCount,
            episodeCount: (totalEntries || 0) - (movieCount || 0) - (tvShowCount || 0),
            averageRating: parseFloat((avgRating as any) || 0),
            totalWatchTime: totalEntries,
        };

        statsSummaryCache.set(userId, stats, 60 * 1000); // 60s in-memory TTL

        res.json({ stats });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

/**
 * GET /api/v1/entries/compare/:targetUserId
 * Compare current user's watch history with target user's watch history
 * Subject to privacy settings and follow relationships.
 */
router.get('/compare/:targetUserId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { targetUserId } = req.params;
        const currentUserId = (req as any).user?.userId || (req as any).user?.id || (req as any).user?.sub;

        const userSelectFields = {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            profilePictureUrl: users.profilePictureUrl,
            isPrivate: users.isPrivate,
            privacyLevel: users.privacyLevel,
            showWatchEntries: users.showWatchEntries,
        };

        // Fetch target user & requesting user
        const [targetUser] = await db.select(userSelectFields).from(users).where(eq(users.id, targetUserId)).limit(1);
        if (!targetUser) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const [currentUser] = currentUserId ? await db.select(userSelectFields).from(users).where(eq(users.id, currentUserId)).limit(1) : [];
        if (!currentUser) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        // Privacy & Security Access Enforcement
        const isOwner = currentUserId === targetUserId;
        if (!isOwner) {
            // Check if user disabled watch entries visibility
            if (targetUser.showWatchEntries === false) {
                res.status(403).json({ error: 'User has hidden their watch history.' });
                return;
            }

            // Check profile privacy level
            const privacyLevel = targetUser.privacyLevel || (targetUser.isPrivate ? 'FOLLOWERS_ONLY' : 'PUBLIC');
            if (privacyLevel === 'PRIVATE') {
                res.status(403).json({ error: 'This profile is private.' });
                return;
            }

            if (privacyLevel === 'FOLLOWERS_ONLY') {
                const [followRecord] = await db.select().from(follows).where(
                    and(eq(follows.followerId, currentUserId), eq(follows.followingId, targetUserId))
                ).limit(1);

                if (!followRecord) {
                    res.status(403).json({ error: 'You must follow this user to compare watch histories.' });
                    return;
                }
            }
        }

        // Fetch watch entries for User A (current user) and User B (target user)
        const userAEntries = await db.select().from(entries).where(eq(entries.userId, currentUserId));
        const userBEntries = await db.select().from(entries).where(eq(entries.userId, targetUserId));

        // Create lookup maps by tmdbId
        const userAMap = new Map<number, typeof userAEntries[0]>();
        userAEntries.forEach(e => userAMap.set(e.tmdbId, e));

        const userBMap = new Map<number, typeof userBEntries[0]>();
        userBEntries.forEach(e => userBMap.set(e.tmdbId, e));

        const allTmdbIds = Array.from(new Set([...userAMap.keys(), ...userBMap.keys()]));

        const commonItems: any[] = [];
        const userAOnlyItems: any[] = [];
        const userBOnlyItems: any[] = [];

        for (const tmdbId of allTmdbIds) {
            const entryA = userAMap.get(tmdbId);
            const entryB = userBMap.get(tmdbId);

            if (entryA && entryB) {
                commonItems.push({
                    tmdbId,
                    title: entryA.title || entryB.title,
                    type: entryA.type || entryB.type,
                    entryA: {
                        id: entryA.id,
                        rating: entryA.rating,
                        review: entryA.review,
                        watchedAt: entryA.watchedAt,
                    },
                    entryB: {
                        id: entryB.id,
                        rating: entryB.rating,
                        review: entryB.review,
                        watchedAt: entryB.watchedAt,
                    },
                });
            } else if (entryA) {
                userAOnlyItems.push({
                    tmdbId,
                    title: entryA.title,
                    type: entryA.type,
                    rating: entryA.rating,
                    watchedAt: entryA.watchedAt,
                });
            } else if (entryB) {
                userBOnlyItems.push({
                    tmdbId,
                    title: entryB.title,
                    type: entryB.type,
                    rating: entryB.rating,
                    watchedAt: entryB.watchedAt,
                });
            }
        }

        // Calculate Compatibility / Swarm Match Score
        const totalUniqueTitles = allTmdbIds.length;
        const matchPercentage = totalUniqueTitles > 0
            ? Math.round((commonItems.length / totalUniqueTitles) * 100)
            : 0;

        res.json({
            userA: formatUserWithAvatar({
                id: currentUser.id,
                username: currentUser.username,
                displayName: currentUser.displayName,
                profilePictureUrl: currentUser.profilePictureUrl,
            }),
            userB: formatUserWithAvatar({
                id: targetUser.id,
                username: targetUser.username,
                displayName: targetUser.displayName,
                profilePictureUrl: targetUser.profilePictureUrl,
            }),
            stats: {
                matchPercentage,
                totalCommon: commonItems.length,
                totalUserAOnly: userAOnlyItems.length,
                totalUserBOnly: userBOnlyItems.length,
                totalUnique: totalUniqueTitles,
            },
            commonItems,
            userAOnlyItems,
            userBOnlyItems,
        });
    } catch (error) {
        console.error('Error comparing watch histories:', error);
        res.status(500).json({ error: 'Failed to compare watch histories' });
    }
});

router.get(
    '/:id',
    authMiddleware,
    param('id').isUUID().withMessage('Invalid entry ID'),
    async (req: Request, res: Response): Promise<any> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ errors: errors.array() });
                return;
            }

            const { id } = req.params;
            const userId = (req as any).user.userId;

            const entry = await db.query.entries.findFirst({
                where: eq(entries.id, id),
                with: {
                    user: {
                        columns: {
                            id: true,
                            username: true,
                            displayName: true,
                            profilePictureUrl: true,
                            isPrivate: true,
                            privacyLevel: true,
                        }
                    },
                    suggestedByUser: {
                        columns: {
                            id: true,
                            username: true,
                            displayName: true,
                            profilePictureUrl: true,
                        }
                    },
                    likes: {
                        columns: {
                            userId: true
                        }
                    },
                    comments: {
                        orderBy: desc(comments.createdAt),
                        with: {
                            user: {
                                columns: {
                                    id: true,
                                    username: true,
                                    displayName: true,
                                    profilePictureUrl: true,
                                }
                            }
                        }
                    }
                }
            });

            if (!entry) {
                return res.status(404).json({ error: 'Entry not found' });
            }

            // If entry owner is not current user, verify privacy
            if (entry.userId !== userId) {
                const author = entry.user as any;
                const isPrivate = author?.privacyLevel === 'PRIVATE' || author?.privacyLevel === 'FOLLOWERS_ONLY' || author?.isPrivate === true;
                if (isPrivate) {
                    const [isFollower] = await db
                        .select()
                        .from(follows)
                        .where(and(eq(follows.followerId, userId), eq(follows.followingId, entry.userId)))
                        .limit(1);
                    if (!isFollower) {
                        return res.status(403).json({ error: 'This post is private.' });
                    }
                }
            }

            // Manually add counts
            const [[{ likesCount }], [{ commentsCount }]] = await Promise.all([
                db.select({ likesCount: count() }).from(likes).where(eq(likes.entryId, id)),
                db.select({ commentsCount: count() }).from(comments).where(eq(comments.entryId, id))
            ]);

            const isLiked = entry.likes?.some((l: any) => l.userId === userId) ?? false;

            res.json({
                entry: {
                    ...entry,
                    user: entry.user ? formatUserWithAvatar(entry.user) : entry.user,
                    suggestedByUser: entry.suggestedByUser ? formatUserWithAvatar(entry.suggestedByUser) : null,
                    comments: entry.comments?.map((c: any) => ({
                        ...c,
                        user: c.user ? formatUserWithAvatar(c.user) : c.user,
                    })),
                    isLiked,
                    _count: { likes: likesCount, comments: commentsCount }
                }
            });
        } catch (error) {
            console.error('Get entry error:', error);
            res.status(500).json({ error: 'Failed to fetch entry' });
        }
    }
);

/**
 * @openapi
 * /api/v1/entries/{id}:
 *   put:
 *     tags: [Entries]
 *     summary: Update a watch entry
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [MOVIE, TV_SHOW, EPISODE]
 *               watchedAt:
 *                 type: string
 *                 format: date-time
 *               rating:
 *                 type: integer
 *               review:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               isRewatch:
 *                 type: boolean
 *               watchLocation:
 *                 type: string
 *     responses:
 *       200:
 *         description: Entry updated successfully
 *       404:
 *         description: Entry not found
 */
router.put(
    '/:id',
    authMiddleware,
    param('id').isUUID().withMessage('Invalid entry ID'),
    [
        body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
        body('type').optional().isIn(['MOVIE', 'TV_SHOW', 'EPISODE']).withMessage('Invalid entry type'),
        body('watchedAt').optional().isISO8601().withMessage('Invalid date format'),
        body('rating').optional().isFloat({ min: 0, max: 10 }).withMessage('Rating must be between 0 and 10'),
        body('review').optional().trim(),
        body('tags').optional().isArray().withMessage('Tags must be an array'),
        body('isRewatch').optional().isBoolean().withMessage('isRewatch must be boolean'),
        body('isWatching').optional().isBoolean().withMessage('isWatching must be boolean'),
        body('startedAt').optional({ nullable: true }).isISO8601().withMessage('Invalid date format'),
        body('completedAt').optional({ nullable: true }).isISO8601().withMessage('Invalid date format'),
        body('watchLocation').optional().trim(),
        body('postToFeed').optional().isBoolean().withMessage('postToFeed must be boolean'),
        body('currentSeason').optional({ nullable: true }).isInt({ min: 0 }).withMessage('currentSeason must be a positive integer'),
        body('currentEpisode').optional({ nullable: true }).isInt({ min: 0 }).withMessage('currentEpisode must be a positive integer'),
    ],
    async (req: Request, res: Response): Promise<any> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ errors: errors.array() });
                return;
            }

            const { id } = req.params;
            const userId = (req as any).user.userId;

            // Check if entry exists and belongs to user
            const [existingEntry] = await db
                .select()
                .from(entries)
                .where(and(eq(entries.id, id), eq(entries.userId, userId)))
                .limit(1);

            if (!existingEntry) {
                return res.status(404).json({ error: 'Entry not found' });
            }

            // Update entry
            const updateData = { ...req.body };
            const now = new Date();
            if (existingEntry.isWatching && (updateData.isWatching === false || updateData.rating || updateData.review)) {
                updateData.isWatching = false;
                if (!existingEntry.startedAt && !updateData.startedAt) {
                    updateData.startedAt = existingEntry.watchedAt || existingEntry.createdAt;
                }
                if (!updateData.completedAt) updateData.completedAt = updateData.watchedAt || now;
                if (!updateData.watchedAt) updateData.watchedAt = updateData.completedAt;
            }
            if (existingEntry.tmdbId && updateData.isWatching === false) {
                // Clear any other active currently-watching sessions for this title
                await db
                    .update(entries)
                    .set({ isWatching: false, completedAt: updateData.completedAt || now, watchedAt: updateData.watchedAt || updateData.completedAt || now, updatedAt: now })
                    .where(and(eq(entries.userId, userId), eq(entries.tmdbId, existingEntry.tmdbId), eq(entries.isWatching, true)));
            }
            if (req.body.watchedAt === null || req.body.watchedAt === '' || req.body.unspecifiedDate === true) {
                updateData.watchedAt = null;
            } else if (updateData.watchedAt) {
                updateData.watchedAt = resolveValidDate(updateData.watchedAt, now);
            }
            if (updateData.startedAt) updateData.startedAt = resolveValidDate(updateData.startedAt, null);
            if (updateData.completedAt) updateData.completedAt = resolveValidDate(updateData.completedAt, null);
            if (updateData.isWatching === false) {
                if (updateData.completedAt && !updateData.watchedAt && req.body.unspecifiedDate !== true) {
                    updateData.watchedAt = updateData.completedAt;
                } else if (updateData.watchedAt && !updateData.completedAt) {
                    updateData.completedAt = updateData.watchedAt;
                }
            }
            if (updateData.rating) updateData.rating = updateData.rating.toString();
            if (updateData.postToFeed !== undefined) updateData.postToFeed = Boolean(updateData.postToFeed);
            if (updateData.currentSeason !== undefined) {
                updateData.currentSeason = updateData.currentSeason !== null ? Number(updateData.currentSeason) : null;
            }
            if (updateData.currentEpisode !== undefined) {
                updateData.currentEpisode = updateData.currentEpisode !== null ? Number(updateData.currentEpisode) : null;
            }

            await db
                .update(entries)
                .set({ ...updateData, updatedAt: now })
                .where(eq(entries.id, id));

            // Fetch fully populated updated entry
            const entry = await db.query.entries.findFirst({
                where: eq(entries.id, id),
                with: {
                    user: {
                        columns: {
                            id: true,
                            username: true,
                            displayName: true,
                            profilePictureUrl: true,
                        }
                    },
                    suggestedByUser: {
                        columns: {
                            id: true,
                            username: true,
                            displayName: true,
                            profilePictureUrl: true,
                        }
                    }
                }
            });

            const [[{ likesCount }], [{ commentsCount }]] = await Promise.all([
                db.select({ likesCount: count() }).from(likes).where(eq(likes.entryId, id)),
                db.select({ commentsCount: count() }).from(comments).where(eq(comments.entryId, id))
            ]);

            // Notify followers if watching status changed (fire & forget) if allowed to post to feed
            const isEntryPostedToFeed = updateData.postToFeed !== undefined ? updateData.postToFeed : existingEntry.postToFeed;
            if (existingEntry.isWatching && updateData.isWatching === false && isEntryPostedToFeed) {
                const actorName = entry?.user?.displayName || entry?.user?.username || 'Someone';
                const actorAvatar = entry?.user?.profilePictureUrl || null;
                notifyFollowersOfActivity({
                    actorId: userId,
                    actorName,
                    actorAvatar,
                    entryId: id,
                    entryTitle: entry?.title || existingEntry.title,
                    mediaType: entry?.type || existingEntry.type,
                    rating: updateData.rating ? Number(updateData.rating) : (existingEntry.rating ? Number(existingEntry.rating) : null),
                    review: updateData.review !== undefined ? updateData.review : existingEntry.review,
                    isWatching: false,
                    tmdbId: entry?.tmdbId || existingEntry.tmdbId,
                }).catch(err => console.error('[FollowerActivity] Notification error on PUT:', err));
            } else if (!existingEntry.isWatching && updateData.isWatching === true) {
                const actorName = entry?.user?.displayName || entry?.user?.username || 'Someone';
                const actorAvatar = entry?.user?.profilePictureUrl || null;
                notifyFollowersOfActivity({
                    actorId: userId,
                    actorName,
                    actorAvatar,
                    entryId: id,
                    entryTitle: entry?.title || existingEntry.title,
                    mediaType: entry?.type || existingEntry.type,
                    rating: null,
                    review: null,
                    isWatching: true,
                    tmdbId: entry?.tmdbId || existingEntry.tmdbId,
                }).catch(err => console.error('[FollowerActivity] Notification error on PUT:', err));
            }

            if (existingEntry.isWatching && updateData.isWatching === false) {
                try {
                    await xpService.updateStreakAndCheckBadges(userId);
                    if (existingEntry.suggestedByUserId) {
                        await xpService.awardXp(userId, XpAction.COMPLETE_SUGGESTION);
                        await xpService.checkSuggestionBadges(userId);
                    }
                } catch (streakErr) {
                    console.error('[Entries] Error updating streak/badges on completion:', streakErr);
                }
            }

            invalidateUserCaches(userId);

            res.json({
                message: 'Entry updated successfully',
                entry: {
                    ...entry,
                    user: entry?.user ? formatUserWithAvatar(entry.user) : entry?.user,
                    suggestedByUser: entry?.suggestedByUser ? formatUserWithAvatar(entry.suggestedByUser) : null,
                    _count: { likes: likesCount, comments: commentsCount }
                },
            });
        } catch (error) {
            console.error('Update entry error:', error);
            res.status(500).json({ error: 'Failed to update entry' });
        }
    }
);

/**
 * @openapi
 * /api/v1/entries/{id}:
 *   delete:
 *     tags: [Entries]
 *     summary: Delete a watch entry
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
 *         description: Entry deleted successfully
 *       404:
 *         description: Entry not found
 */
router.delete(
    '/:id',
    authMiddleware,
    param('id').isUUID().withMessage('Invalid entry ID'),
    async (req: Request, res: Response): Promise<any> => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ errors: errors.array() });
                return;
            }

            const { id } = req.params;
            const userId = (req as any).user.userId;

            // Check if entry exists and belongs to user
            const [existingEntry] = await db
                .select()
                .from(entries)
                .where(and(eq(entries.id, id), eq(entries.userId, userId)))
                .limit(1);

            if (!existingEntry) {
                return res.status(404).json({ error: 'Entry not found' });
            }

            // Delete entry (cascading deletes handled by DB)
            await db.delete(entries).where(eq(entries.id, id));

            invalidateUserCaches(userId);

            res.json({
                message: 'Entry deleted successfully',
            });
        } catch (error) {
            console.error('Delete entry error:', error);
            res.status(500).json({ error: 'Failed to delete entry' });
        }
    }
);

export default router;
