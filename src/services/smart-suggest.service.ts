import { db } from '../db/index.js';
import { users, entries, follows, suggestions, lists } from '../db/schema.js';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import tmdbService from './tmdb.service.js';
import { formatUserWithAvatar } from '../utils/avatar.util.js';

export interface SmartSuggestBadge {
    type: 'friend_pick' | 'network_buzz' | 'critical_acclaim' | 'palate_cleanser' | 'taste_match' | 'watchlist';
    label: string;
    avatarUrl?: string | null;
    meta?: string;
}

export interface SmartSuggestItem {
    tmdbId: number;
    title: string;
    mediaType: 'movie' | 'tv';
    posterPath: string | null;
    backdropPath: string | null;
    overview: string | null;
    releaseDate: string | null;
    voteAverage: number;
    voteCount: number;
    score: number;
    badges: SmartSuggestBadge[];
    genreNames: string[];
    suggestedBy?: {
        id: string;
        username: string;
        displayName: string | null;
        profilePictureUrl: string | null;
        note?: string | null;
    } | null;
}

export interface SmartSuggestResponse {
    mode: 'social' | 'critic' | 'explore';
    items: SmartSuggestItem[];
    lastWatchedTitle?: string | null;
    lastWatchedGenre?: string | null;
}

const TMDB_GENRES: Record<number, string> = {
    28: 'Action',
    12: 'Adventure',
    16: 'Animation',
    35: 'Comedy',
    80: 'Crime',
    99: 'Documentary',
    18: 'Drama',
    10751: 'Family',
    14: 'Fantasy',
    36: 'History',
    27: 'Horror',
    10402: 'Music',
    9648: 'Mystery',
    10749: 'Romance',
    878: 'Sci-Fi',
    10770: 'TV Movie',
    53: 'Thriller',
    10752: 'War',
    37: 'Western',
    10759: 'Action & Adventure',
    10762: 'Kids',
    10765: 'Sci-Fi & Fantasy',
};

class SmartSuggestService {
    /**
     * Generates a personalized recommendations list balancing social recommendations,
     * critical consensus, personal taste, and diversity nudges.
     */
    async getSmartSuggestions(
        userId: string,
        mode: 'social' | 'critic' | 'explore' = 'social',
        limit: number = 10
    ): Promise<SmartSuggestResponse> {
        try {
            // 1. Fetch user's existing history & preferences
            const [userLoggedEntries, userWatchlist, userFollows, directSuggestions] = await Promise.all([
                // A. User's entries (to exclude already watched, and compute recent/top genres)
                db.select({
                    id: entries.id,
                    tmdbId: entries.tmdbId,
                    type: entries.type,
                    title: entries.title,
                    rating: entries.rating,
                    createdAt: entries.createdAt,
                    completedAt: entries.completedAt,
                    suggestedByUserId: entries.suggestedByUserId,
                })
                .from(entries)
                .where(eq(entries.userId, userId))
                .orderBy(desc(sql`COALESCE(${entries.completedAt}, ${entries.createdAt})`))
                .limit(100),

                // B. User's Watchlist (to highlight items already bookmarked)
                db.query.lists.findFirst({
                    where: and(eq(lists.userId, userId), eq(lists.name, 'Watchlist')),
                    with: {
                        items: {
                            columns: {
                                tmdbId: true,
                                mediaType: true,
                            }
                        }
                    }
                }),

                // C. Followed Users (for network buzz & trusted friends)
                db.select({
                    followingId: follows.followingId,
                })
                .from(follows)
                .where(eq(follows.followerId, userId)),

                // D. Direct Friend Suggestions received by this user
                db.select({
                    id: suggestions.id,
                    fromUserId: suggestions.fromUserId,
                    tmdbId: suggestions.tmdbId,
                    mediaType: suggestions.mediaType,
                    message: suggestions.message,
                    createdAt: suggestions.createdAt,
                    fromUser: {
                        id: users.id,
                        username: users.username,
                        displayName: users.displayName,
                        profilePictureUrl: users.profilePictureUrl,
                    }
                })
                .from(suggestions)
                .innerJoin(users, eq(suggestions.fromUserId, users.id))
                .where(eq(suggestions.toUserId, userId))
                .orderBy(desc(suggestions.createdAt))
                .limit(25),
            ]);

            const watchedTmdbIds = new Set(userLoggedEntries.map(e => Number(e.tmdbId)));
            const watchlistTmdbIds = new Set(userWatchlist?.items?.map(i => Number(i.tmdbId)) || []);
            const followedUserIds = userFollows.map(f => f.followingId);

            // Calculate Friend Impact Multiplier: how often user liked recommendations from each friend
            const friendTrustMultiplier = new Map<string, number>();
            userLoggedEntries.forEach(entry => {
                if (entry.suggestedByUserId && entry.rating) {
                    const r = parseFloat(entry.rating);
                    if (r > 0) {
                        const current = friendTrustMultiplier.get(entry.suggestedByUserId) || 1.0;
                        // Boost multiplier if user rated the suggestion >= 7.5
                        friendTrustMultiplier.set(entry.suggestedByUserId, r >= 7.5 ? current + 0.15 : current);
                    }
                }
            });

            // 2. Fetch network activity (recent highly rated watches by followed users)
            let networkRecentEntries: any[] = [];
            if (followedUserIds.length > 0) {
                networkRecentEntries = await db
                    .select({
                        tmdbId: entries.tmdbId,
                        type: entries.type,
                        title: entries.title,
                        rating: entries.rating,
                        userId: entries.userId,
                        user: {
                            id: users.id,
                            username: users.username,
                            displayName: users.displayName,
                        }
                    })
                    .from(entries)
                    .innerJoin(users, eq(entries.userId, users.id))
                    .where(and(
                        inArray(entries.userId, followedUserIds.slice(0, 30)),
                        sql`CAST(${entries.rating} AS NUMERIC) >= 7.5`
                    ))
                    .orderBy(desc(entries.createdAt))
                    .limit(20);
            }

            // Group network entries by tmdbId to identify resonance
            const networkBuzzMap = new Map<number, { count: number; friendNames: string[] }>();
            networkRecentEntries.forEach(e => {
                const id = Number(e.tmdbId);
                if (watchedTmdbIds.has(id)) return;
                const existing = networkBuzzMap.get(id) || { count: 0, friendNames: [] };
                existing.count++;
                if (e.user?.displayName || e.user?.username) {
                    existing.friendNames.push(e.user.displayName || e.user.username);
                }
                networkBuzzMap.set(id, existing);
            });

            // 3. Last watched title context for diversity and palate cleansers
            let lastWatchedTitle: string | null = null;
            let lastWatchedGenre: string | null = null;
            let recentGenreIds: number[] = [];

            if (userLoggedEntries.length > 0) {
                lastWatchedTitle = userLoggedEntries[0].title;
                try {
                    const primaryDetails = userLoggedEntries[0].type === 'TV_SHOW'
                        ? await tmdbService.getTVShowDetails(userLoggedEntries[0].tmdbId)
                        : await tmdbService.getMovieDetails(userLoggedEntries[0].tmdbId);
                    
                    if (primaryDetails?.genres && primaryDetails.genres.length > 0) {
                        lastWatchedGenre = primaryDetails.genres[0].name;
                        recentGenreIds = (primaryDetails.genres as any[]).map((g: any) => g.id);
                    }
                } catch {
                    // Non-fatal fallback
                }
            }

            // 4. Gather Candidate Pool from TMDb
            const candidateMap = new Map<number, {
                item: any;
                source: 'friend_suggestion' | 'network' | 'trending' | 'recommendation' | 'explore';
                suggestedBy?: any;
            }>();

            // A. Add unwatched direct friend suggestions
            for (const s of directSuggestions) {
                const tmdbId = Number(s.tmdbId);
                if (!watchedTmdbIds.has(tmdbId)) {
                    try {
                        const mediaType = s.mediaType === 'tv' ? 'tv' : 'movie';
                        const details = mediaType === 'tv'
                            ? await tmdbService.getTVShowDetails(tmdbId)
                            : await tmdbService.getMovieDetails(tmdbId);
                        
                        if (details) {
                            candidateMap.set(tmdbId, {
                                item: { ...details, media_type: mediaType },
                                source: 'friend_suggestion',
                                suggestedBy: {
                                    ...formatUserWithAvatar(s.fromUser),
                                    note: s.message,
                                }
                            });
                        }
                    } catch {
                        // Skip if TMDb lookup fails
                    }
                }
            }

            // B. Add recommendations based on highest rated entry
            const topRatedEntry = userLoggedEntries.find(e => parseFloat(e.rating || '0') >= 8.0) || userLoggedEntries[0];
            if (topRatedEntry && candidateMap.size < 20) {
                try {
                    const recs = topRatedEntry.type === 'TV_SHOW'
                        ? await tmdbService.getTVShowRecommendations(topRatedEntry.tmdbId)
                        : await tmdbService.getMovieRecommendations(topRatedEntry.tmdbId);

                    for (const r of (recs?.results || []).slice(0, 8)) {
                        const id = Number(r.id);
                        if (!watchedTmdbIds.has(id) && !candidateMap.has(id)) {
                            candidateMap.set(id, {
                                item: { ...r, media_type: topRatedEntry.type === 'TV_SHOW' ? 'tv' : 'movie' },
                                source: 'recommendation',
                            });
                        }
                    }
                } catch {
                    // Non-fatal
                }
            }

            // C. Add Trending / Critic Acclaim candidates
            try {
                const trending = await tmdbService.getTrending('movie', 'week');
                for (const r of (trending?.results || []).slice(0, 10)) {
                    const id = Number(r.id);
                    if (!watchedTmdbIds.has(id) && !candidateMap.has(id)) {
                        candidateMap.set(id, {
                            item: { ...r, media_type: 'movie' },
                            source: 'trending',
                        });
                    }
                }
            } catch {
                // Non-fatal
            }

            // D. If in Explore mode, pull contrasting genres (e.g. Comedy/Animation/Mystery if recent was Horror/Drama)
            if (mode === 'explore' || candidateMap.size < 12) {
                const candidateGenres = [35, 16, 9648, 878, 12, 18, 28].filter(g => !recentGenreIds.includes(g));
                const targetGenre = candidateGenres[Math.floor(Math.random() * candidateGenres.length)] || 35;

                try {
                    const explorePicks = await tmdbService.discoverMoviesByGenre([targetGenre], 1);
                    for (const r of (explorePicks?.results || []).slice(0, 8)) {
                        const id = Number(r.id);
                        if (!watchedTmdbIds.has(id) && !candidateMap.has(id)) {
                            candidateMap.set(id, {
                                item: { ...r, media_type: 'movie' },
                                source: 'explore',
                            });
                        }
                    }
                } catch {
                    // Non-fatal
                }
            }

            // 5. Score and rank candidates
            const scoredItems: SmartSuggestItem[] = [];

            for (const [tmdbId, candidate] of candidateMap.entries()) {
                const item = candidate.item;
                const itemGenres: number[] = (item.genre_ids || item.genres?.map((g: any) => g.id) || []);
                const genreNames = itemGenres.map(gid => TMDB_GENRES[gid]).filter(Boolean);
                const voteAvg = Number(item.vote_average || 0);
                const voteCount = Number(item.vote_count || 0);

                let socialScore = 0;
                let consensusScore = 0;
                let tasteScore = 0;
                let diversityBonus = 0;
                let fatiguePenalty = 0;
                const badges: SmartSuggestBadge[] = [];

                // 1. Social Factor
                if (candidate.source === 'friend_suggestion' && candidate.suggestedBy) {
                    const trust = friendTrustMultiplier.get(candidate.suggestedBy.id) || 1.0;
                    socialScore += 35 * trust;
                    badges.push({
                        type: 'friend_pick',
                        label: `Suggested by @${candidate.suggestedBy.username}`,
                        avatarUrl: candidate.suggestedBy.profilePictureUrl,
                        meta: candidate.suggestedBy.note || (trust > 1.1 ? 'High Taste Match' : undefined),
                    });
                }

                // Check network buzz (friends who rated or logged it)
                const buzz = networkBuzzMap.get(tmdbId);
                if (buzz && buzz.count > 0) {
                    socialScore += Math.min(buzz.count * 8, 20);
                    badges.push({
                        type: 'network_buzz',
                        label: buzz.count === 1 
                            ? `Loved by ${buzz.friendNames[0]}`
                            : `Loved by ${buzz.count} friends you follow`,
                    });
                }

                // 2. Public Consensus Factor
                if (voteAvg > 0) {
                    consensusScore += (voteAvg / 10) * 28;
                    if (voteAvg >= 7.8 && voteCount >= 400) {
                        consensusScore += 7;
                        badges.push({
                            type: 'critical_acclaim',
                            label: `${voteAvg.toFixed(1)}★ Acclaim`,
                            meta: `${voteCount >= 1000 ? `${(voteCount / 1000).toFixed(1)}k` : voteCount} ratings`,
                        });
                    }
                }

                // 3. Personal Taste Match
                // If candidate shares genres with user's top entries
                const matchesGenre = itemGenres.some(g => [28, 878, 18, 53, 35, 12].includes(g));
                if (matchesGenre) {
                    tasteScore += 18;
                }

                // 4. Diversity / Palate Cleanser Bonus
                const isContrasting = recentGenreIds.length > 0 && !itemGenres.some(g => recentGenreIds.includes(g));
                if (isContrasting) {
                    diversityBonus += mode === 'explore' ? 25 : 12;
                    if (lastWatchedGenre && genreNames.length > 0) {
                        badges.push({
                            type: 'palate_cleanser',
                            label: `Palate Cleanser (${genreNames[0]})`,
                            meta: `A fresh shift from ${lastWatchedGenre}`,
                        });
                    }
                }

                // 5. Fatigue Penalty
                const isDuplicateOfRecent = recentGenreIds.length > 0 && itemGenres.every(g => recentGenreIds.includes(g));
                if (isDuplicateOfRecent && mode === 'explore') {
                    fatiguePenalty += 15;
                }

                // 6. Watchlist Bonus
                if (watchlistTmdbIds.has(tmdbId)) {
                    tasteScore += 12;
                    badges.unshift({
                        type: 'watchlist',
                        label: 'Saved on your Watchlist',
                    });
                }

                // Mode Multipliers
                let finalScore = 0;
                if (mode === 'social') {
                    finalScore = (socialScore * 1.5) + (consensusScore * 0.8) + (tasteScore * 0.9) + (diversityBonus * 0.8) - fatiguePenalty;
                } else if (mode === 'critic') {
                    finalScore = (socialScore * 0.6) + (consensusScore * 1.6) + (tasteScore * 0.9) + (diversityBonus * 0.6) - fatiguePenalty;
                } else { // explore
                    finalScore = (socialScore * 0.7) + (consensusScore * 0.8) + (tasteScore * 0.7) + (diversityBonus * 1.8) - (fatiguePenalty * 1.4);
                }

                // Normalize score between 60 and 99
                const normalizedScore = Math.min(99, Math.max(62, Math.round(finalScore)));

                scoredItems.push({
                    tmdbId,
                    title: item.title || item.name || 'Untitled',
                    mediaType: item.media_type === 'tv' ? 'tv' : 'movie',
                    posterPath: item.poster_path || null,
                    backdropPath: item.backdrop_path || null,
                    overview: item.overview || null,
                    releaseDate: item.release_date || item.first_air_date || null,
                    voteAverage: voteAvg,
                    voteCount,
                    score: normalizedScore,
                    badges,
                    genreNames,
                    suggestedBy: candidate.suggestedBy || null,
                });
            }

            // Sort by final score descending
            scoredItems.sort((a, b) => b.score - a.score);

            return {
                mode,
                items: scoredItems.slice(0, limit),
                lastWatchedTitle,
                lastWatchedGenre,
            };
        } catch (error) {
            console.error('[SmartSuggestService] Error generating suggestions:', error);
            throw error;
        }
    }
}

export const smartSuggestService = new SmartSuggestService();
export default smartSuggestService;
