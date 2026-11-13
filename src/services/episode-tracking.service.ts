import { db } from '../db/index.js';
import { entries, episodeWatches, follows, users } from '../db/schema.js';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import tmdbService from './tmdb.service.js';
import { invalidateUserCaches } from '../utils/cache.util.js';
import { resolveAvatarUrl } from '../utils/avatar.util.js';

export interface WatchEpisodeParams {
    userId: string;
    tmdbId: number;
    seasonNumber: number;
    episodeNumber: number;
    episodeId?: number;
    episodeName?: string;
    isWatched?: boolean;
    rating?: number;
    review?: string;
    postToFeed?: boolean;
}

export interface BatchCatchUpParams {
    userId: string;
    tmdbId: number;
    upToSeason: number;
    upToEpisode: number;
}

export interface WatchedEpisodeRecord {
    id: string;
    seasonNumber: number;
    episodeNumber: number;
    episodeName?: string | null;
    watchedAt: Date;
    rating?: string | null;
    review?: string | null;
}

export interface ShowProgressResponse {
    tmdbId: number;
    title: string;
    posterPath: string | null;
    backdropPath?: string | null;
    currentSeason: number | null;
    currentEpisode: number | null;
    totalEpisodesWatched: number;
    totalEpisodesCount: number | null;
    progressPercentage: number;
    watchedEpisodes: WatchedEpisodeRecord[];
    nextEpisodeUp: {
        seasonNumber: number;
        episodeNumber: number;
        name?: string;
        stillPath?: string;
        airDate?: string;
    } | null;
}

export interface ContinueWatchingItem {
    entryId?: string;
    tmdbId: number;
    title: string;
    posterPath: string | null;
    backdropPath: string | null;
    currentSeason: number;
    currentEpisode: number;
    totalEpisodesWatched: number;
    totalEpisodesCount: number | null;
    progressPercentage: number;
    nextEpisodeUp: {
        seasonNumber: number;
        episodeNumber: number;
        name?: string;
        stillPath?: string;
        airDate?: string;
    } | null;
    lastWatchedAt: Date;
}

export class EpisodeTrackingService {
    /**
     * Mark or unmark a specific episode as watched
     */
    async toggleEpisodeWatch(params: WatchEpisodeParams): Promise<ShowProgressResponse> {
        const {
            userId,
            tmdbId,
            seasonNumber,
            episodeNumber,
            episodeId,
            episodeName,
            isWatched = true,
            rating,
            review,
            postToFeed = false,
        } = params;

        if (isWatched) {
            // Upsert into episode_watches
            await db.insert(episodeWatches).values({
                userId,
                tmdbId,
                seasonNumber,
                episodeNumber,
                episodeId: episodeId || null,
                episodeName: episodeName || null,
                watchedAt: new Date(),
                rating: rating ? rating.toString() : null,
                review: review || null,
                postToFeed,
            }).onConflictDoUpdate({
                target: [episodeWatches.userId, episodeWatches.tmdbId, episodeWatches.seasonNumber, episodeWatches.episodeNumber],
                set: {
                    watchedAt: new Date(),
                    rating: rating ? rating.toString() : null,
                    review: review || null,
                    postToFeed,
                },
            });
        } else {
            // Delete record
            await db.delete(episodeWatches).where(
                and(
                    eq(episodeWatches.userId, userId),
                    eq(episodeWatches.tmdbId, tmdbId),
                    eq(episodeWatches.seasonNumber, seasonNumber),
                    eq(episodeWatches.episodeNumber, episodeNumber)
                )
            );
        }

        // Synchronize and update user's Entry for this TV show
        await this.syncShowEntryProgress(userId, tmdbId, undefined, {
            rating: rating !== undefined ? Number(rating) : undefined,
            review,
            postToFeed: Boolean(postToFeed),
        });

        // Invalidate cached user stats and feeds
        invalidateUserCaches(userId);

        return this.getShowProgress(userId, tmdbId);
    }

    /**
     * Batch catch-up: Marks all episodes from S1E1 up to target season & episode as watched
     */
    async batchCatchUp(params: BatchCatchUpParams): Promise<ShowProgressResponse> {
        const { userId, tmdbId, upToSeason, upToEpisode } = params;

        let tvDetails: any = null;
        try {
            tvDetails = await tmdbService.getTVShowDetails(tmdbId);
        } catch {
            // TMDb unavailable or rate-limited; proceed with fallback logic
        }

        const seasonsList = tvDetails?.seasons || [];
        const recordsToInsert: Array<{
            userId: string;
            tmdbId: number;
            seasonNumber: number;
            episodeNumber: number;
            watchedAt: Date;
        }> = [];

        for (let s = 1; s <= upToSeason; s++) {
            let maxEp = upToEpisode;
            if (s < upToSeason) {
                const sMeta = seasonsList.find((x: any) => x.season_number === s);
                maxEp = sMeta?.episode_count || 24; // Fallback to reasonable season count
            }

            for (let e = 1; e <= maxEp; e++) {
                recordsToInsert.push({
                    userId,
                    tmdbId,
                    seasonNumber: s,
                    episodeNumber: e,
                    watchedAt: new Date(),
                });
            }
        }

        if (recordsToInsert.length > 0) {
            // Chunk inserts in batches of 100 for database performance
            const chunkSize = 100;
            for (let i = 0; i < recordsToInsert.length; i += chunkSize) {
                const chunk = recordsToInsert.slice(i, i + chunkSize);
                await db.insert(episodeWatches).values(chunk).onConflictDoNothing();
            }
        }

        await this.syncShowEntryProgress(userId, tmdbId, tvDetails);

        // Invalidate cached user stats and feeds
        invalidateUserCaches(userId);

        return this.getShowProgress(userId, tmdbId);
    }

    /**
     * Synchronize the entry record for this TV show with aggregate episode stats
     */
    private async syncShowEntryProgress(
        userId: string,
        tmdbId: number,
        cachedDetails?: any,
        extra?: { rating?: number; review?: string; postToFeed?: boolean }
    ) {
        // Query all watched episodes for this show
        const watched = await db.select().from(episodeWatches)
            .where(and(eq(episodeWatches.userId, userId), eq(episodeWatches.tmdbId, tmdbId)))
            .orderBy(asc(episodeWatches.seasonNumber), asc(episodeWatches.episodeNumber));

        const totalWatched = watched.length;

        let latestSeason: number | null = null;
        let latestEpisode: number | null = null;

        if (watched.length > 0) {
            const last = watched[watched.length - 1];
            latestSeason = last.seasonNumber;
            latestEpisode = last.episodeNumber;
        }

        let tvDetails = cachedDetails;
        if (!tvDetails) {
            try {
                tvDetails = await tmdbService.getTVShowDetails(tmdbId);
            } catch {
                // Ignore TMDb fetch failure
            }
        }

        const totalEpisodesCount = tvDetails?.number_of_episodes || null;
        const title = tvDetails?.name || 'TV Series';
        const posterPath = tvDetails?.poster_path || null;
        const backdropPath = tvDetails?.backdrop_path || null;

        // Check if an entry already exists
        const existingEntries = await db.select().from(entries)
            .where(and(eq(entries.userId, userId), eq(entries.tmdbId, tmdbId)));

        const now = new Date();
        const isCompleted = Boolean(totalEpisodesCount && totalWatched >= totalEpisodesCount);

        // Prefer updating an active watching entry or unrated placeholder so completed reviews are never clobbered
        const activeWatchingEntry = existingEntries.find(e => e.isWatching);
        const placeholderEntry = existingEntries.find(e => !e.isWatching && e.rating === null && !e.review);
        const targetEntry = activeWatchingEntry || placeholderEntry;

        if (targetEntry) {
            const completionTime = isCompleted ? (targetEntry.completedAt || now) : null;
            const watchTime = isCompleted ? (targetEntry.completedAt || now) : (targetEntry.watchedAt || now);

            await db.update(entries)
                .set({
                    currentSeason: latestSeason,
                    currentEpisode: latestEpisode,
                    totalEpisodesWatched: totalWatched,
                    totalEpisodesCount: totalEpisodesCount ?? targetEntry.totalEpisodesCount,
                    isWatching: !isCompleted && totalWatched > 0,
                    completedAt: completionTime,
                    watchedAt: watchTime,
                    ...(extra?.rating !== undefined && extra.rating > 0 ? { rating: extra.rating.toString() } : {}),
                    ...(extra?.review !== undefined && extra.review.trim().length > 0 ? { review: extra.review.trim() } : {}),
                    ...(extra?.postToFeed !== undefined ? { postToFeed: extra.postToFeed } : {}),
                    updatedAt: now,
                })
                .where(eq(entries.id, targetEntry.id));
        } else if (totalWatched > 0) {
            // Create a new in-progress or completed entry
            await db.insert(entries).values({
                userId,
                tmdbId,
                title,
                type: 'TV_SHOW',
                isWatching: !isCompleted,
                startedAt: now,
                completedAt: isCompleted ? now : null,
                watchedAt: isCompleted ? now : null,
                posterPath,
                backdropPath,
                currentSeason: latestSeason,
                currentEpisode: latestEpisode,
                totalEpisodesWatched: totalWatched,
                totalEpisodesCount,
                rating: extra?.rating !== undefined && extra.rating > 0 ? extra.rating.toString() : null,
                review: extra?.review !== undefined && extra.review.trim().length > 0 ? extra.review.trim() : null,
                postToFeed: extra?.postToFeed !== undefined ? extra.postToFeed : false,
            });
        }
    }

    /**
     * Get user's full progress for a TV show including watched episode map and next up episode
     */
    async getShowProgress(userId: string, tmdbId: number): Promise<ShowProgressResponse> {
        let tvDetails: any = null;
        try {
            tvDetails = await tmdbService.getTVShowDetails(tmdbId);
        } catch {
            // Non-fatal
        }

        const watched = await db.select().from(episodeWatches)
            .where(and(eq(episodeWatches.userId, userId), eq(episodeWatches.tmdbId, tmdbId)))
            .orderBy(asc(episodeWatches.seasonNumber), asc(episodeWatches.episodeNumber));

        let currentSeason: number | null = null;
        let currentEpisode: number | null = null;

        if (watched.length > 0) {
            const last = watched[watched.length - 1];
            currentSeason = last.seasonNumber;
            currentEpisode = last.episodeNumber;
        }

        const totalEpisodesCount = tvDetails?.number_of_episodes || null;
        const totalEpisodesWatched = watched.length;
        const progressPercentage = totalEpisodesCount && totalEpisodesCount > 0
            ? Math.min(100, Math.round((totalEpisodesWatched / totalEpisodesCount) * 100))
            : 0;

        // Calculate next episode up
        let nextEpisodeUp: ShowProgressResponse['nextEpisodeUp'] = null;
        if (currentSeason !== null && currentEpisode !== null) {
            const seasons = tvDetails?.seasons || [];
            const currSeasonMeta = seasons.find((s: any) => s.season_number === currentSeason);
            const seasonEpCount = currSeasonMeta?.episode_count || 0;

            if (seasonEpCount > 0 && currentEpisode < seasonEpCount) {
                // Next episode in same season
                nextEpisodeUp = {
                    seasonNumber: currentSeason,
                    episodeNumber: currentEpisode + 1,
                };
            } else {
                // Check if there is a next season
                const nextSeasonNum = currentSeason + 1;
                const nextSeasonMeta = seasons.find((s: any) => s.season_number === nextSeasonNum);
                if (nextSeasonMeta && nextSeasonMeta.episode_count > 0) {
                    nextEpisodeUp = {
                        seasonNumber: nextSeasonNum,
                        episodeNumber: 1,
                    };
                }
            }
        } else if (tvDetails?.seasons && tvDetails.seasons.length > 0) {
            // If user hasn't watched anything yet, next up is S1 E1
            const firstSeason = tvDetails.seasons.find((s: any) => s.season_number > 0) || tvDetails.seasons[0];
            if (firstSeason && firstSeason.episode_count > 0) {
                nextEpisodeUp = {
                    seasonNumber: firstSeason.season_number,
                    episodeNumber: 1,
                };
            }
        }

        return {
            tmdbId,
            title: tvDetails?.name || 'TV Series',
            posterPath: tvDetails?.poster_path || null,
            backdropPath: tvDetails?.backdrop_path || null,
            currentSeason,
            currentEpisode,
            totalEpisodesWatched,
            totalEpisodesCount,
            progressPercentage,
            watchedEpisodes: watched.map(w => ({
                id: w.id,
                seasonNumber: w.seasonNumber,
                episodeNumber: w.episodeNumber,
                episodeName: w.episodeName,
                watchedAt: w.watchedAt,
                rating: w.rating,
                review: w.review,
            })),
            nextEpisodeUp,
        };
    }

    /**
     * Get Continue Watching tray: active TV shows with progress and next episode
     */
    async getContinueWatching(userId: string, limit: number = 15): Promise<ContinueWatchingItem[]> {
        // Find TV entries where user is watching or has partially watched episodes
        const activeEntries = await db.select().from(entries)
            .where(
                and(
                    eq(entries.userId, userId),
                    eq(entries.type, 'TV_SHOW'),
                    eq(entries.isWatching, true)
                )
            )
            .orderBy(desc(entries.updatedAt))
            .limit(limit);

        const items: ContinueWatchingItem[] = [];

        for (const entry of activeEntries) {
            const progress = await this.getShowProgress(userId, entry.tmdbId);
            const resolvedSeason = progress.currentSeason ?? entry.currentSeason;
            const resolvedEpisode = progress.currentEpisode ?? entry.currentEpisode;

            if (resolvedSeason !== null && resolvedEpisode !== null) {
                const resolvedPoster = entry.posterPath || progress.posterPath || null;
                const resolvedBackdrop = entry.backdropPath || progress.backdropPath || null;
                const resolvedTitle = (entry.title && entry.title !== 'Untitled' && entry.title !== 'this TV show')
                    ? entry.title
                    : (progress.title || 'TV Series');

                if (!entry.posterPath && resolvedPoster) {
                    db.update(entries)
                        .set({ posterPath: resolvedPoster, backdropPath: resolvedBackdrop })
                        .where(eq(entries.id, entry.id))
                        .catch(() => {});
                }

                items.push({
                    entryId: entry.id,
                    tmdbId: entry.tmdbId,
                    title: resolvedTitle,
                    posterPath: resolvedPoster,
                    backdropPath: resolvedBackdrop,
                    currentSeason: resolvedSeason,
                    currentEpisode: resolvedEpisode,
                    totalEpisodesWatched: progress.totalEpisodesWatched,
                    totalEpisodesCount: progress.totalEpisodesCount,
                    progressPercentage: progress.progressPercentage,
                    nextEpisodeUp: progress.nextEpisodeUp,
                    lastWatchedAt: entry.updatedAt,
                });
            }
        }

        return items;
    }

    /**
     * Get friends who are also watching this TV show and their progress
     */
    async getFriendsProgress(userId: string, tmdbId: number) {
        // Get user's following list
        const followedUsers = await db.select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            avatarUrl: users.profilePictureUrl,
        })
        .from(follows)
        .innerJoin(users, eq(follows.followingId, users.id))
        .where(eq(follows.followerId, userId));

        if (followedUsers.length === 0) return [];

        const friendIds = followedUsers.map(f => f.id);

        // Find friends who have an entry or episode watches for this tmdbId
        const friendEntries = await db.select({
            userId: entries.userId,
            currentSeason: entries.currentSeason,
            currentEpisode: entries.currentEpisode,
            totalEpisodesWatched: entries.totalEpisodesWatched,
            totalEpisodesCount: entries.totalEpisodesCount,
            isWatching: entries.isWatching,
        })
        .from(entries)
        .where(
            and(
                eq(entries.tmdbId, tmdbId),
                inArray(entries.userId, friendIds)
            )
        );

        return friendEntries.map(fe => {
            const friend = followedUsers.find(f => f.id === fe.userId);
            const resolvedAvatar = resolveAvatarUrl(friend?.avatarUrl);
            return {
                user: friend ? {
                    id: friend.id,
                    username: friend.username,
                    displayName: friend.displayName,
                    avatarUrl: resolvedAvatar,
                    profilePictureUrl: resolvedAvatar,
                } : null,
                currentSeason: fe.currentSeason,
                currentEpisode: fe.currentEpisode,
                totalEpisodesWatched: fe.totalEpisodesWatched,
                totalEpisodesCount: fe.totalEpisodesCount,
                isWatching: fe.isWatching,
            };
        });
    }
}

export const episodeTrackingService = new EpisodeTrackingService();
