import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { users, entries, follows, blockedUsers } from '../db/schema.js';
import { eq, desc, sql, inArray, and, or, not, aliasedTable } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware.js';
import tmdbService from '../services/tmdb.service.js';
import { formatUserWithAvatar } from '../utils/avatar.util.js';

const router = Router();

/**
 * @openapi
 * tags:
 *   name: Feed
 *   description: Activity feed and content discovery
 */

/**
 * @openapi
 * /api/v1/feed/trending:
 *   get:
 *     tags: [Feed]
 *     summary: Get top trending topics and entries
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Trending items
 */
router.get('/trending', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
    try {
        // 1. Fetch recent entries with interaction counts (last 30 days)
        const recentEntries = await db.select({
            id: entries.id,
            tmdbId: entries.tmdbId,
            title: entries.title,
            tags: entries.tags,
            likesCount: sql<number>`(SELECT count(*) FROM likes WHERE likes.entry_id = ${entries.id})`.mapWith(Number),
            commentsCount: sql<number>`(SELECT count(*) FROM comments WHERE comments.entry_id = ${entries.id})`.mapWith(Number),
        })
            .from(entries)
            .where(and(sql`${entries.createdAt} > NOW() - INTERVAL '30 days'`, sql`(${entries.postToFeed} IS NOT FALSE)`));

        // 2. Aggregate in memory
        const buzzMap = new Map<number, { title: string, context: string, buzzes: number, tags: string[] }>();

        for (const entry of recentEntries) {
            const current = buzzMap.get(entry.tmdbId) || {
                title: entry.title,
                context: '',
                buzzes: 0,
                tags: entry.tags || []
            };

            // Buzz Score Formula: (Entries x 5) + (Comments x 3) + (Likes x 2)
            const entryBuzz = 5 + ((entry.commentsCount || 0) * 3) + ((entry.likesCount || 0) * 2);
            
            current.buzzes += entryBuzz;
            
            // Generate context from tags
            if (entry.tags && entry.tags.length > 0 && !current.context) {
                current.context = `Trending in ${entry.tags[0]}`;
                current.tags = entry.tags;
            }

            buzzMap.set(entry.tmdbId, current);
        }

        const trending = Array.from(buzzMap.values()).sort((a, b) => b.buzzes - a.buzzes).map(x => ({
            title: x.title,
            context: x.context || 'Trending Movie',
            buzzes: x.buzzes,
        }));

        // 3. Fallback to TMDB if less than 3
        if (trending.length < 3) {
            try {
                const tmdbTrending = await tmdbService.getTrending('all', 'week');
                const fallbackItems = tmdbTrending.results.slice(0, 5).map((r: any) => ({
                    title: r.title || r.name,
                    context: r.media_type === 'tv' ? 'Trending TV Show' : 'Trending Movie',
                    buzzes: Math.floor(r.popularity * 10), // fake buzz metric based on popularity
                }));
                
                // Add TMDB items that aren't already in our trending list
                for (const fallback of fallbackItems) {
                    if (!trending.some(t => t.title === fallback.title)) {
                        trending.push(fallback);
                    }
                }
            } catch (err) {
                console.error("Failed to fetch TMDB fallback for trending", err);
            }
        }

        res.json({ trending: trending.slice(0, 5) });
    } catch (error) {
        console.error('Trending feed error:', error);
        res.status(500).json({ error: 'Failed to fetch trending topics' });
    }
});

/**
 * @openapi
 * /api/v1/feed:
 *   get:
 *     tags: [Feed]
 *     summary: Get mixed activity feed
 *     description: Returns a personalized mix of followed user entries and system suggestions.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Mixed feed items
 */

router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user.userId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const offset = (page - 1) * limit;

        // 1. Get followed user IDs
        const followList = await db
            .select({ followingId: follows.followingId })
            .from(follows)
            .where(eq(follows.followerId, userId));

        const followedIds = followList.map(f => f.followingId);

        // 1.1 Exclude blocked users (either blocked by userId or blocking userId)
        const blocks = await db
            .select({
                blockerId: blockedUsers.blockerId,
                blockedId: blockedUsers.blockedId,
            })
            .from(blockedUsers)
            .where(
                or(
                    eq(blockedUsers.blockerId, userId),
                    eq(blockedUsers.blockedId, userId)
                )
            );

        const blockedUserIds = new Set(
            blocks.flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== userId)
        );

        // Filter followed IDs to exclude blocked users
        const activeFollowedIds = followedIds.filter(id => !blockedUserIds.has(id));

        // Include self in the feed
        const relevantUserIds = [...activeFollowedIds, userId];

        const suggestor = aliasedTable(users, 'suggestor');

        // 2. Fetch Entries (Followed + Self)
        const rawEntries = await db.select({
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
            postToFeed: entries.postToFeed,
            user: {
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                profilePictureUrl: users.profilePictureUrl,
                isPrivate: users.isPrivate,
                privacyLevel: users.privacyLevel
            },
            suggestedByUser: {
                id: suggestor.id,
                username: suggestor.username,
                displayName: suggestor.displayName,
                profilePictureUrl: suggestor.profilePictureUrl
            },
            isImported: entries.isImported,
            likesCount: sql<number>`(SELECT count(*) FROM likes WHERE likes.entry_id = ${entries.id})`.mapWith(Number),
            commentsCount: sql<number>`(SELECT count(*) FROM comments WHERE comments.entry_id = ${entries.id})`.mapWith(Number),
            isLiked: sql<boolean>`EXISTS(SELECT 1 FROM likes WHERE likes.entry_id = ${entries.id} AND likes.user_id = ${userId})`,
            isCommented: sql<boolean>`EXISTS(SELECT 1 FROM comments WHERE comments.entry_id = ${entries.id} AND comments.user_id = ${userId})`
        })
            .from(entries)
            .innerJoin(users, eq(entries.userId, users.id))
            .leftJoin(suggestor, eq(entries.suggestedByUserId, suggestor.id))
            .where(
                and(
                    inArray(entries.userId, relevantUserIds),
                    or(
                        eq(entries.userId, userId),
                        not(eq(users.privacyLevel, 'PRIVATE'))
                    ),
                    // Exclude imported entries and watch history from the community feed
                    sql`(${entries.isImported} IS NOT TRUE)`,
                    sql`(NOT ('imported' = ANY(COALESCE(${entries.tags}, ARRAY[]::text[]))))`,
                    sql`(${entries.postToFeed} IS NOT FALSE)`
                )
            )
            .orderBy(desc(entries.updatedAt))
            .limit(limit)
            .offset(offset);

        // Deduplicate rawEntries by (userId + tmdbId): if a user started watching a title and completed it, keep only the completed/reviewed entry
        const deduplicatedRawEntries = (rawEntries as any[]).filter((e: any, _idx: number, arr: any[]) => {
            if (!e.tmdbId) return true;
            const sameUserTmdbEntries = arr.filter(item => item.tmdbId === e.tmdbId && item.userId === e.userId);
            if (sameUserTmdbEntries.length > 1) {
                const hasCompletedVersion = sameUserTmdbEntries.some(item => item.id !== e.id && (item.rating != null || (item.review && item.review.trim().length > 0) || (!item.isWatching && item.completedAt)));
                if (e.isWatching || (e.rating == null && (!e.review || e.review.trim().length === 0) && hasCompletedVersion)) {
                    return false;
                }
            }
            return true;
        });

        // Sort chronologically by latest activity date (started watching, completed, reviewed, or logged)
        const sortedEntries = (deduplicatedRawEntries as any[]).sort((a, b) => {
            const timeA = new Date(a.updatedAt || a.completedAt || a.startedAt || a.createdAt || a.watchedAt).getTime();
            const timeB = new Date(b.updatedAt || b.completedAt || b.startedAt || b.createdAt || b.watchedAt).getTime();
            return timeB - timeA;
        });

        // 3. Advanced Suggestions Generation (WatchHive Movie Recommender)
        let suggestions: any[] = [];

        try {
            // A. Fetch the user's most recent entries for contextual suggestions
            const userRecentEntries = await db
                .select({
                    id: entries.id,
                    tmdbId: entries.tmdbId,
                    title: entries.title,
                    type: entries.type,
                })
                .from(entries)
                .where(eq(entries.userId, userId))
                .orderBy(desc(sql`COALESCE(${entries.updatedAt}, ${entries.completedAt}, ${entries.startedAt}, ${entries.createdAt}, ${entries.watchedAt})`))
                .limit(3);

            const tmdbRecs: any[] = [];

            // Fetch TMDb recommendations for the user's primary/latest watched title
            if (userRecentEntries.length > 0) {
                const primaryEntry = userRecentEntries[0];
                try {
                    const recs = primaryEntry.type === 'TV_SHOW'
                        ? await tmdbService.getTVShowRecommendations(primaryEntry.tmdbId)
                        : await tmdbService.getMovieRecommendations(primaryEntry.tmdbId);

                    if (recs && recs.results && recs.results.length > 0) {
                        tmdbRecs.push(...recs.results.map((r: any) => ({
                            ...r,
                            reason: `Because you watched ${primaryEntry.title}`
                        })));
                    }
                } catch (recErr) {
                    console.error(`Failed to fetch recommendations for ${primaryEntry.title}:`, recErr);
                }

                // If primary produced few recs and a 2nd recent entry exists, fetch for it too
                if (tmdbRecs.length < 6 && userRecentEntries.length > 1) {
                    const secondaryEntry = userRecentEntries[1];
                    try {
                        const recs = secondaryEntry.type === 'TV_SHOW'
                            ? await tmdbService.getTVShowRecommendations(secondaryEntry.tmdbId)
                            : await tmdbService.getMovieRecommendations(secondaryEntry.tmdbId);

                        if (recs && recs.results && recs.results.length > 0) {
                            tmdbRecs.push(...recs.results.map((r: any) => ({
                                ...r,
                                reason: `Because you watched ${secondaryEntry.title}`
                            })));
                        }
                    } catch {
                        // Ignore secondary errors
                    }
                }
            }

            // Global trending items
            let trendingItems: any[] = [];
            try {
                const globalTrending = await tmdbService.getTrending('all', 'week');
                if (globalTrending && globalTrending.results) {
                    trendingItems = globalTrending.results.map((r: any) => ({
                        ...r,
                        reason: "Trending this week"
                    }));
                }
            } catch (trendErr) {
                console.error("Failed to fetch trending for feed suggestions", trendErr);
            }

            // Fetch all tmdbIds this user has logged so we never recommend titles they've already seen
            const userLoggedEntries = await db
                .select({ tmdbId: entries.tmdbId })
                .from(entries)
                .where(eq(entries.userId, userId));
            const userWatchedTmdbSet = new Set(userLoggedEntries.map(e => e.tmdbId));

            // Combine: Contextual recommendations first, followed by trending highlights
            const rawCandidates = [...tmdbRecs, ...trendingItems];
            const seenIds = new Set<number>();
            suggestions = [];

            for (const item of rawCandidates) {
                if (!item || !item.id) continue;
                if (userWatchedTmdbSet.has(item.id)) continue;
                if (seenIds.has(item.id)) continue;
                seenIds.add(item.id);
                suggestions.push(item);
            }

        } catch (err) {
            console.error('Failed to fetch advanced suggestions', err);
            try {
                const fallback = await tmdbService.getTrending('all', 'week');
                suggestions = (fallback?.results || []).map((r: any) => ({ ...r, reason: "Trending Now" }));
            } catch (fallbackErr) {
                console.error('Fallback also failed:', fallbackErr);
                suggestions = [];
            }
        }

        // Pre-fetch watched status for candidate entry items on this page
        const candidateTmdbIds = Array.from(new Set(
            sortedEntries.map((e: any) => e.tmdbId)
        )).filter((id): id is number => typeof id === 'number' && id > 0);

        const watchedTmdbSet = new Set<string>();
        if (candidateTmdbIds.length > 0) {
            const matchedWatched = await db
                .select({ tmdbId: entries.tmdbId, type: entries.type })
                .from(entries)
                .where(
                    and(
                        eq(entries.userId, userId),
                        inArray(entries.tmdbId, candidateTmdbIds)
                    )
                );
            matchedWatched.forEach(e => watchedTmdbSet.add(`${e.type}-${e.tmdbId}`));
        }

        // 4. Mix Content Strategy
        const TARGET_PAGE_FEED_SIZE = 12;
        const feedItems: any[] = [];
        let suggestionIndex = (page - 1) * 3;

        const mappedEntries = (sortedEntries as any[]).map(entry => ({
            type: 'ENTRY',
            id: entry.id,
            timestamp: entry.updatedAt || entry.completedAt || entry.startedAt || entry.watchedAt,
            data: {
                ...entry,
                user: entry.user ? formatUserWithAvatar(entry.user) : entry.user,
                suggestedByUser: entry.suggestedByUser && entry.suggestedByUser.id ? formatUserWithAvatar(entry.suggestedByUser) : null,
                _count: { likes: entry.likesCount, comments: entry.commentsCount },
                isLiked: entry.isLiked,
                isCommented: entry.isCommented,
                isWatched: watchedTmdbSet.has(`${entry.type}-${entry.tmdbId}`)
            }
        }));

        if (mappedEntries.length === 0 && page === 1) {
            // New user with 0 entries & 0 follows: Show full discovery suggestions
            suggestions.slice(0, TARGET_PAGE_FEED_SIZE).forEach((item, idx) => {
                feedItems.push({
                    type: 'SUGGESTION',
                    id: `suggestion-${item.id}-${page}-${idx}`,
                    timestamp: new Date(),
                    data: {
                        ...item,
                        isWatched: false
                    },
                    reason: item.reason || "Trending on WatchHive"
                });
            });
        } else {
            // User has entries (1 or more)
            // When there are few entries (<= 3), interleave after every entry.
            // When there are many entries (> 3), interleave every 3 entries.
            const interleaveInterval = mappedEntries.length <= 3 ? 1 : 3;

            for (let i = 0; i < mappedEntries.length; i++) {
                feedItems.push(mappedEntries[i]);

                if ((i + 1) % interleaveInterval === 0 && suggestions.length > 0) {
                    const sugg = suggestions[suggestionIndex % suggestions.length];
                    if (sugg) {
                        feedItems.push({
                            type: 'SUGGESTION',
                            id: `suggestion-${sugg.id}-${page}-${i}`,
                            timestamp: mappedEntries[i].timestamp || new Date(),
                            data: {
                                ...sugg,
                                isWatched: false
                            },
                            reason: sugg.reason || "Trending Now"
                        });
                        suggestionIndex++;
                    }
                }
            }

            // On page 1, if feed has fewer items than TARGET_PAGE_FEED_SIZE (e.g. user logged only 1 movie),
            // fill remaining slots with recommender suggestions!
            if (page === 1 && suggestions.length > 0) {
                let padCount = 0;
                while (feedItems.length < TARGET_PAGE_FEED_SIZE && padCount < suggestions.length) {
                    const sugg = suggestions[suggestionIndex % suggestions.length];
                    if (sugg) {
                        const alreadyInFeed = feedItems.some(f => f.type === 'SUGGESTION' && f.data?.id === sugg.id);
                        if (!alreadyInFeed) {
                            feedItems.push({
                                type: 'SUGGESTION',
                                id: `suggestion-${sugg.id}-${page}-pad-${padCount}`,
                                timestamp: new Date(),
                                data: {
                                    ...sugg,
                                    isWatched: false
                                },
                                reason: sugg.reason || "Trending Now"
                            });
                        }
                    }
                    suggestionIndex++;
                    padCount++;
                }
            }
        }

        res.json({
            items: feedItems,
            nextPage: rawEntries.length === limit ? page + 1 : null,
            hasMore: rawEntries.length === limit
        });

    } catch (error) {
        console.error('Feed error:', error);
        res.status(500).json({ error: 'Failed to fetch feed' });
    }
});

export default router;
