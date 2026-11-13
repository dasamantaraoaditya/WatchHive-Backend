import { db } from '../db/index.js';
import { entries, follows, suggestions, lists, listItems, users } from '../db/schema.js';
import { eq, desc, inArray, and } from 'drizzle-orm';
import tmdbService from './tmdb.service.js';
import { smartSuggestContextCache } from '../utils/cache.util.js';

export type SmartSuggestMode = 'social' | 'watchlist' | 'explore';

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
    mode: SmartSuggestMode;
    items: SmartSuggestItem[];
    lastWatchedTitle?: string | null;
    lastWatchedGenre?: string | null;
}

export interface SmartSuggestOptions {
    mode?: SmartSuggestMode | 'critic';
    limit?: number;
    excludeIds?: number[];
    seed?: number;
    languages?: string[];
    genres?: string[];
}

// TMDb Standard Genre Map (Movies & TV)
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
    10763: 'News',
    10764: 'Reality',
    10765: 'Sci-Fi & Fantasy',
    10766: 'Soap',
    10767: 'Talk',
    10768: 'War & Politics',
};

const GENRE_NAME_TO_IDS: Record<string, number[]> = {
    'action': [28, 10759],
    'adventure': [12, 10759],
    'animation': [16],
    'anime': [16],
    'comedy': [35],
    'crime': [80],
    'documentary': [99],
    'drama': [18],
    'k-drama': [18],
    'kdrama': [18],
    'family': [10751],
    'fantasy': [14, 10765],
    'history': [36],
    'horror': [27],
    'music': [10402],
    'mystery': [9648],
    'romance': [10749],
    'sci-fi': [878, 10765],
    'science fiction': [878, 10765],
    'thriller': [53],
    'war': [10752, 10768],
    'western': [37],
};

const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
    'english': 'en',
    'hindi': 'hi',
    'telugu': 'te',
    'tamil': 'ta',
    'malayalam': 'ml',
    'kannada': 'kn',
    'korean': 'ko',
    'japanese': 'ja',
    'spanish': 'es',
    'french': 'fr',
    'german': 'de',
    'italian': 'it',
    'chinese': 'zh',
    'mandarin': 'zh',
    'portuguese': 'pt',
};

interface CachedUserContext {
    allEntries: Array<{
        tmdbId: number;
        title: string;
        type: string;
        rating: string | null;
        isWatching: boolean;
        watchedAt: Date | null;
    }>;
    watchedOrWatchingIds: Set<number>;
    watchlistRows: Array<{ tmdbId: number; mediaType: string | null }>;
    watchlistIds: Set<number>;
    directSuggestions: Array<{
        tmdbId: number;
        mediaType: string;
        message: string | null;
        fromUserId: string;
        createdAt: Date;
        fromUsername: string;
        fromDisplayName: string | null;
        fromAvatar: string | null;
    }>;
    directSuggestionIds: Set<number>;
    followingIds: string[];
    networkEntries: Array<{
        tmdbId: number;
        title: string;
        type: string;
        rating: string | null;
        userId: string;
    }>;
    userPrefs: {
        genres?: string[];
        genreIds?: number[];
        languages?: string[];
    };
}

interface CandidateData {
    tmdbId: number;
    title: string;
    mediaType: 'movie' | 'tv';
    posterPath: string | null;
    backdropPath: string | null;
    overview: string | null;
    releaseDate: string | null;
    voteAverage: number;
    voteCount: number;
    genreIds: number[];
    originalLanguage?: string;
    isFriendSuggestion: boolean;
    friendSuggestMeta?: {
        id: string;
        username: string;
        displayName: string | null;
        profilePictureUrl: string | null;
        note?: string | null;
    } | null;
    networkBuzzCount: number;
    isWatchlist: boolean;
    watchlistRank?: number;
    isWorldTopRated?: boolean;
    isPreferencePick?: boolean;
}

function createSeededRandom(seed: number): () => number {
    let a = (seed >>> 0) || 1;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function normalizeLanguageCode(lang: string): string | null {
    const trimmed = lang.trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed.length === 2) return trimmed;
    return LANGUAGE_NAME_TO_CODE[trimmed] || null;
}

export class SmartSuggestService {
    private normalizeMode(mode?: string): SmartSuggestMode {
        if (mode === 'watchlist' || mode === 'critic') return 'watchlist';
        if (mode === 'explore') return 'explore';
        return 'social';
    }

    private async getUserContext(userId: string): Promise<CachedUserContext> {
        const cached = smartSuggestContextCache.get(userId) as CachedUserContext | undefined;
        if (cached) return cached;

        const [allEntries, userRows, userWatchlists, directSuggestions, followingRows] = await Promise.all([
            db
                .select({
                    tmdbId: entries.tmdbId,
                    title: entries.title,
                    type: entries.type,
                    rating: entries.rating,
                    isWatching: entries.isWatching,
                    watchedAt: entries.watchedAt,
                })
                .from(entries)
                .where(eq(entries.userId, userId))
                .orderBy(desc(entries.watchedAt)),
            db
                .select({ preferences: users.preferences })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1),
            db
                .select({ id: lists.id })
                .from(lists)
                .where(and(eq(lists.userId, userId), eq(lists.type, 'WATCHLIST'))),
            db
                .select({
                    tmdbId: suggestions.tmdbId,
                    mediaType: suggestions.mediaType,
                    message: suggestions.message,
                    fromUserId: suggestions.fromUserId,
                    createdAt: suggestions.createdAt,
                    fromUsername: users.username,
                    fromDisplayName: users.displayName,
                    fromAvatar: users.profilePictureUrl,
                })
                .from(suggestions)
                .innerJoin(users, eq(suggestions.fromUserId, users.id))
                .where(and(eq(suggestions.toUserId, userId), eq(suggestions.status, 'pending')))
                .orderBy(desc(suggestions.createdAt))
                .limit(30),
            db
                .select({ followingId: follows.followingId })
                .from(follows)
                .where(eq(follows.followerId, userId)),
        ]);

        const watchedOrWatchingIds = new Set<number>(allEntries.map((e) => e.tmdbId));

        let watchlistRows: Array<{ tmdbId: number; mediaType: string | null }> = [];
        if (userWatchlists.length > 0) {
            const listIds = userWatchlists.map((l) => l.id);
            watchlistRows = await db
                .select({
                    tmdbId: listItems.tmdbId,
                    mediaType: listItems.mediaType,
                })
                .from(listItems)
                .where(inArray(listItems.listId, listIds))
                .orderBy(desc(listItems.addedAt))
                .limit(50);
        }

        const watchlistIds = new Set<number>(watchlistRows.map((w) => w.tmdbId));
        const directSuggestionIds = new Set<number>(directSuggestions.map((s) => Number(s.tmdbId)));
        const followingIds = followingRows.map((f) => f.followingId);

        let networkEntries: CachedUserContext['networkEntries'] = [];
        if (followingIds.length > 0) {
            networkEntries = await db
                .select({
                    tmdbId: entries.tmdbId,
                    title: entries.title,
                    type: entries.type,
                    rating: entries.rating,
                    userId: entries.userId,
                })
                .from(entries)
                .where(inArray(entries.userId, followingIds))
                .orderBy(desc(entries.watchedAt))
                .limit(80);
        }

        const userPrefs = (userRows[0]?.preferences as CachedUserContext['userPrefs']) || {};

        const ctx: CachedUserContext = {
            allEntries,
            watchedOrWatchingIds,
            watchlistRows,
            watchlistIds,
            directSuggestions,
            directSuggestionIds,
            followingIds,
            networkEntries,
            userPrefs,
        };

        smartSuggestContextCache.set(userId, ctx, 90 * 1000);
        return ctx;
    }

    private extractPreferenceProfile(
        ctx: CachedUserContext,
        overrideLanguages?: string[],
        overrideGenres?: string[]
    ): {
        preferredGenreIds: Set<number>;
        preferredLanguages: string[];
        topRatedEntries: CachedUserContext['allEntries'];
        lastWatchedEntry: CachedUserContext['allEntries'][0] | null;
    } {
        const preferredGenreIds = new Set<number>();

        if (Array.isArray(ctx.userPrefs.genreIds)) {
            for (const id of ctx.userPrefs.genreIds) {
                const num = Number(id);
                if (Number.isFinite(num) && num > 0) preferredGenreIds.add(num);
            }
        }

        const genreNames = [
            ...(Array.isArray(ctx.userPrefs.genres) ? ctx.userPrefs.genres : []),
            ...(overrideGenres || []),
        ];
        for (const name of genreNames) {
            const ids = GENRE_NAME_TO_IDS[name.trim().toLowerCase()];
            if (ids) {
                ids.forEach((id) => preferredGenreIds.add(id));
            }
        }

        const rawLanguages = [
            ...(Array.isArray(ctx.userPrefs.languages) ? ctx.userPrefs.languages : []),
            ...(overrideLanguages || []),
        ];
        const preferredLanguages = Array.from(
            new Set(
                rawLanguages
                    .map(normalizeLanguageCode)
                    .filter((code): code is string => Boolean(code))
            )
        );

        const topRatedEntries = [...ctx.allEntries]
            .filter((e) => !e.isWatching && (!e.rating || parseFloat(e.rating) >= 7.0))
            .sort((a, b) => (parseFloat(b.rating || '0') - parseFloat(a.rating || '0')))
            .slice(0, 6);

        return {
            preferredGenreIds,
            preferredLanguages,
            topRatedEntries,
            lastWatchedEntry: ctx.allEntries[0] || null,
        };
    }

    private addCandidate(map: Map<number, CandidateData>, item: CandidateData): void {
        if (!item.tmdbId || !item.title) return;
        const existing = map.get(item.tmdbId);
        if (!existing) {
            map.set(item.tmdbId, item);
            return;
        }
        existing.isFriendSuggestion = existing.isFriendSuggestion || item.isFriendSuggestion;
        if (!existing.friendSuggestMeta && item.friendSuggestMeta) {
            existing.friendSuggestMeta = item.friendSuggestMeta;
        }
        existing.networkBuzzCount = Math.max(existing.networkBuzzCount, item.networkBuzzCount);
        existing.isWatchlist = existing.isWatchlist || item.isWatchlist;
        existing.isWorldTopRated = existing.isWorldTopRated || item.isWorldTopRated;
        existing.isPreferencePick = existing.isPreferencePick || item.isPreferencePick;
        if (existing.genreIds.length === 0 && item.genreIds.length > 0) {
            existing.genreIds = item.genreIds;
        }
    }

    private mapTmdbResultToCandidate(
        raw: any,
        mediaTypeFallback: 'movie' | 'tv',
        flags: Partial<Pick<CandidateData, 'isWorldTopRated' | 'isPreferencePick' | 'networkBuzzCount'>> = {}
    ): CandidateData | null {
        const tmdbId = Number(raw?.id);
        const title = raw?.title || raw?.name;
        if (!tmdbId || !title) return null;

        const mediaType: 'movie' | 'tv' =
            raw.media_type === 'tv' || raw.media_type === 'movie' ? raw.media_type : mediaTypeFallback;

        return {
            tmdbId,
            title,
            mediaType,
            posterPath: raw.poster_path || null,
            backdropPath: raw.backdrop_path || null,
            overview: raw.overview || null,
            releaseDate: raw.release_date || raw.first_air_date || null,
            voteAverage: Number(raw.vote_average) || 0,
            voteCount: Number(raw.vote_count) || 0,
            genreIds: Array.isArray(raw.genre_ids)
                ? raw.genre_ids.map(Number)
                : Array.isArray(raw.genres)
                    ? raw.genres.map((g: any) => Number(g.id))
                    : [],
            originalLanguage: raw.original_language || undefined,
            isFriendSuggestion: false,
            networkBuzzCount: flags.networkBuzzCount || 0,
            isWatchlist: false,
            isWorldTopRated: flags.isWorldTopRated || false,
            isPreferencePick: flags.isPreferencePick || false,
        };
    }

    private async fetchTmdbDetailsSafe(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<any | null> {
        try {
            return mediaType === 'tv'
                ? await tmdbService.getTVShowDetails(tmdbId)
                : await tmdbService.getMovieDetails(tmdbId);
        } catch {
            return null;
        }
    }

    private async gatherSocialCandidates(
        ctx: CachedUserContext,
        preferredGenreIds: Set<number>,
        preferredLanguages: string[],
        seed: number
    ): Promise<Map<number, CandidateData>> {
        const candidateMap = new Map<number, CandidateData>();
        const { watchedOrWatchingIds, watchlistIds } = ctx;

        // 1. Direct friend suggestions (unwatched/not-watching) in parallel
        const unwatchedSuggestions = ctx.directSuggestions
            .filter((s) => !watchedOrWatchingIds.has(Number(s.tmdbId)))
            .slice(0, 20);

        const directTasks = unwatchedSuggestions.map(async (s) => {
            const tmdbId = Number(s.tmdbId);
            const mediaType = s.mediaType === 'tv' ? 'tv' : 'movie';
            const details = await this.fetchTmdbDetailsSafe(tmdbId, mediaType);
            if (!details) return;

            this.addCandidate(candidateMap, {
                tmdbId,
                title: details.title || details.name,
                mediaType,
                posterPath: details.poster_path || null,
                backdropPath: details.backdrop_path || null,
                overview: details.overview || null,
                releaseDate: details.release_date || details.first_air_date || null,
                voteAverage: Number(details.vote_average) || 0,
                voteCount: Number(details.vote_count) || 0,
                genreIds: (details.genres || []).map((g: any) => g.id),
                originalLanguage: details.original_language,
                isFriendSuggestion: true,
                friendSuggestMeta: {
                    id: s.fromUserId,
                    username: s.fromUsername,
                    displayName: s.fromDisplayName,
                    profilePictureUrl: s.fromAvatar,
                    note: s.message,
                },
                networkBuzzCount: 1,
                isWatchlist: watchlistIds.has(tmdbId),
            });
        });

        // 2. Network buzz from followed users (unwatched/not-watching, rated >= 7 or recent) in parallel
        const buzzMap = new Map<number, { count: number; mediaType: 'movie' | 'tv' }>();
        for (const ne of ctx.networkEntries) {
            if (watchedOrWatchingIds.has(ne.tmdbId)) continue;
            const ratingNum = ne.rating ? parseFloat(ne.rating) : 7.5;
            if (ratingNum < 6.5) continue;
            const prev = buzzMap.get(ne.tmdbId);
            buzzMap.set(ne.tmdbId, {
                count: (prev?.count || 0) + 1,
                mediaType: ne.type === 'TV_SHOW' ? 'tv' : 'movie',
            });
        }

        const topNetworkEntries = Array.from(buzzMap.entries())
            .filter(([tmdbId]) => !ctx.directSuggestionIds.has(tmdbId))
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 18);

        const networkTasks = topNetworkEntries.map(async ([tmdbId, meta]) => {
            const details = await this.fetchTmdbDetailsSafe(tmdbId, meta.mediaType);
            if (!details) return;

            this.addCandidate(candidateMap, {
                tmdbId,
                title: details.title || details.name,
                mediaType: meta.mediaType,
                posterPath: details.poster_path || null,
                backdropPath: details.backdrop_path || null,
                overview: details.overview || null,
                releaseDate: details.release_date || details.first_air_date || null,
                voteAverage: Number(details.vote_average) || 0,
                voteCount: Number(details.vote_count) || 0,
                genreIds: (details.genres || []).map((g: any) => g.id),
                originalLanguage: details.original_language,
                isFriendSuggestion: false,
                networkBuzzCount: meta.count,
                isWatchlist: watchlistIds.has(tmdbId),
            });
        });

        await Promise.allSettled([...directTasks, ...networkTasks]);

        // 3. If social pool has fewer than 16 items, fill with friend-adjacent or popular buzz
        //    excluding watchlist & top-rated explore items so categories stay distinct
        if (candidateMap.size < 16) {
            const page = 1 + (seed % 4);
            const genreArr = Array.from(preferredGenreIds).slice(0, 2);
            const fallbackTasks: Promise<any>[] = [
                tmdbService.getTrending('all', seed % 2 === 0 ? 'day' : 'week').catch(() => ({ results: [] })),
                tmdbService.discoverMedia({
                    mediaType: 'all',
                    sortBy: 'popularity.desc',
                    voteCountGte: 100,
                    withGenres: genreArr.length > 0 ? genreArr.join('|') : undefined,
                    withOriginalLanguage: preferredLanguages[0],
                    page,
                }).catch(() => ({ results: [] })),
            ];

            const [trendingRes, popularRes] = await Promise.all(fallbackTasks);
            for (const raw of [...(trendingRes?.results || []), ...(popularRes?.results || [])]) {
                const tmdbId = Number(raw?.id);
                if (!tmdbId || watchedOrWatchingIds.has(tmdbId) || watchlistIds.has(tmdbId)) continue;
                const cand = this.mapTmdbResultToCandidate(raw, (raw as any).media_type === 'tv' ? 'tv' : 'movie', {
                    networkBuzzCount: 0,
                });
                if (cand) this.addCandidate(candidateMap, cand);
            }
        }

        return candidateMap;
    }

    private async gatherWatchlistCandidates(
        ctx: CachedUserContext,
        preferredGenreIds: Set<number>,
        seed: number
    ): Promise<Map<number, CandidateData>> {
        const candidateMap = new Map<number, CandidateData>();
        const { watchedOrWatchingIds, watchlistRows, directSuggestionIds } = ctx;

        // 1. Fetch exceptional items directly from user's Watchlist in parallel
        const unwatchedWatchlist = watchlistRows
            .filter((w) => !watchedOrWatchingIds.has(w.tmdbId))
            .slice(0, 30);

        const watchlistTasks = unwatchedWatchlist.map(async (w, idx) => {
            const mediaType = w.mediaType === 'tv' ? 'tv' : 'movie';
            const details = await this.fetchTmdbDetailsSafe(w.tmdbId, mediaType);
            if (!details) return;

            this.addCandidate(candidateMap, {
                tmdbId: w.tmdbId,
                title: details.title || details.name,
                mediaType,
                posterPath: details.poster_path || null,
                backdropPath: details.backdrop_path || null,
                overview: details.overview || null,
                releaseDate: details.release_date || details.first_air_date || null,
                voteAverage: Number(details.vote_average) || 0,
                voteCount: Number(details.vote_count) || 0,
                genreIds: (details.genres || []).map((g: any) => g.id),
                originalLanguage: details.original_language,
                isFriendSuggestion: false,
                networkBuzzCount: 0,
                isWatchlist: true,
                watchlistRank: idx,
            });
        });

        await Promise.allSettled(watchlistTasks);

        // 2. If user's watchlist has < 14 unwatched items, supplement with critically acclaimed gems
        //    (different page/threshold from explore & excluding directSuggestions)
        if (candidateMap.size < 14) {
            const page = 2 + (seed % 4);
            const genreArr = Array.from(preferredGenreIds).slice(0, 2);
            const [acclaimedMovies, acclaimedTv] = await Promise.all([
                tmdbService.discoverMedia({
                    mediaType: 'movie',
                    sortBy: 'vote_average.desc',
                    voteCountGte: 800,
                    withGenres: genreArr.length > 0 ? genreArr.join('|') : undefined,
                    page,
                }).catch(() => ({ results: [] })),
                tmdbService.getTopRated('tv', 1 + ((seed + 1) % 3)).catch(() => ({ results: [] })),
            ]);

            for (const raw of [...(acclaimedMovies?.results || []), ...(acclaimedTv?.results || [])]) {
                const tmdbId = Number(raw?.id);
                if (!tmdbId || watchedOrWatchingIds.has(tmdbId) || directSuggestionIds.has(tmdbId)) continue;
                const cand = this.mapTmdbResultToCandidate(raw, (raw as any).media_type === 'tv' ? 'tv' : 'movie', {
                    isWorldTopRated: true,
                });
                if (cand && cand.voteAverage >= 7.5) {
                    this.addCandidate(candidateMap, cand);
                }
            }
        }

        return candidateMap;
    }

    private async gatherExploreCandidates(
        ctx: CachedUserContext,
        preferredGenreIds: Set<number>,
        preferredLanguages: string[],
        topRatedEntries: CachedUserContext['allEntries'],
        seed: number
    ): Promise<Map<number, CandidateData>> {
        const candidateMap = new Map<number, CandidateData>();
        const { watchedOrWatchingIds, watchlistIds, directSuggestionIds } = ctx;

        const topRatedPage = 1 + (seed % 5);
        const discoverPage = 1 + ((seed + 1) % 5);
        const genreList = Array.from(preferredGenreIds);
        const selectedLang = preferredLanguages.length > 0
            ? preferredLanguages[seed % preferredLanguages.length]
            : undefined;

        // Rotate which genre subset is queried on regenerate
        const rotatedGenres = genreList.length > 0
            ? [
                genreList[seed % genreList.length],
                ...(genreList.length > 1 ? [genreList[(seed + 1) % genreList.length]] : []),
            ]
            : [];

        const fetchTasks: Promise<any>[] = [
            // Globally top-rated movies across the world
            tmdbService.getTopRated('movie', topRatedPage).catch(() => ({ results: [] })),
            // Globally top-rated TV shows across the world
            tmdbService.getTopRated('tv', 1 + ((seed + 2) % 4)).catch(() => ({ results: [] })),
            // Top-rated world discover filtered by user preferences (genres / language)
            tmdbService.discoverMedia({
                mediaType: 'movie',
                sortBy: 'vote_average.desc',
                voteCountGte: 250,
                withGenres: rotatedGenres.length > 0 ? rotatedGenres.join('|') : undefined,
                withOriginalLanguage: selectedLang,
                page: discoverPage,
            }).catch(() => ({ results: [] })),
        ];

        // Also pull recommendations from a watch-history top entry (rotated by seed)
        if (topRatedEntries.length > 0) {
            const anchor = topRatedEntries[seed % topRatedEntries.length];
            const recPage = 1 + (seed % 2);
            fetchTasks.push(
                (anchor.type === 'TV_SHOW'
                    ? tmdbService.getTVShowRecommendations(anchor.tmdbId, recPage)
                    : tmdbService.getMovieRecommendations(anchor.tmdbId, recPage)
                ).catch(() => ({ results: [] }))
            );
        }

        const results = await Promise.all(fetchTasks);

        results.forEach((res, idx) => {
            const defaultType: 'movie' | 'tv' = idx === 1 ? 'tv' : 'movie';
            const isPref = idx >= 2;
            for (const raw of res?.results || []) {
                const tmdbId = Number(raw?.id);
                if (!tmdbId || watchedOrWatchingIds.has(tmdbId)) continue;
                // Keep Explore distinct from Social and Watchlist
                if (watchlistIds.has(tmdbId) || directSuggestionIds.has(tmdbId)) continue;

                const cand = this.mapTmdbResultToCandidate(raw, defaultType, {
                    isWorldTopRated: true,
                    isPreferencePick: isPref,
                });
                if (cand) this.addCandidate(candidateMap, cand);
            }
        });

        return candidateMap;
    }

    private scoreAndRank(
        candidates: CandidateData[],
        mode: SmartSuggestMode,
        preferredGenreIds: Set<number>,
        preferredLanguages: string[],
        historyGenreIds: Set<number>,
        excludeIds: Set<number>,
        limit: number,
        seed: number
    ): SmartSuggestItem[] {
        const rand = createSeededRandom(seed);
        const targetCount = Math.max(limit, 10);

        const scoreItem = (c: CandidateData): SmartSuggestItem => {
            const matchingPrefGenres = c.genreIds.filter((g) => preferredGenreIds.has(g));
            const matchingHistoryGenres = c.genreIds.filter((g) => historyGenreIds.has(g));
            const matchesLanguage = Boolean(
                c.originalLanguage && preferredLanguages.includes(c.originalLanguage.toLowerCase())
            );

            let baseScore = 65;
            const badges: SmartSuggestBadge[] = [];

            if (mode === 'social') {
                if (c.isFriendSuggestion && c.friendSuggestMeta) {
                    baseScore += 28;
                    badges.push({
                        type: 'friend_pick',
                        label: `Recommended by ${c.friendSuggestMeta.displayName || c.friendSuggestMeta.username}`,
                        avatarUrl: c.friendSuggestMeta.profilePictureUrl,
                        meta: c.friendSuggestMeta.note || undefined,
                    });
                }
                if (c.networkBuzzCount > 0 && !c.isFriendSuggestion) {
                    baseScore += Math.min(c.networkBuzzCount * 8, 22);
                    badges.push({
                        type: 'network_buzz',
                        label: `${c.networkBuzzCount} ${c.networkBuzzCount === 1 ? 'friend' : 'friends'} in your Hive watched`,
                    });
                }
                baseScore += (c.voteAverage / 10) * 14;
                if (matchingPrefGenres.length > 0 || matchingHistoryGenres.length > 0) baseScore += 8;
                if (matchesLanguage) baseScore += 5;
            } else if (mode === 'watchlist') {
                if (c.isWatchlist) {
                    baseScore += 22;
                    badges.push({
                        type: 'watchlist',
                        label: c.voteAverage >= 7.8 ? 'Exceptional Watchlist Gem' : 'From Your Watchlist',
                    });
                }
                // Strongly reward exceptional TMDb rating & acclaim
                baseScore += (c.voteAverage / 10) * 28;
                if (c.voteAverage >= 8.0 && c.voteCount >= 500) {
                    baseScore += 10;
                    badges.push({
                        type: 'critical_acclaim',
                        label: `Exceptional Acclaim (${c.voteAverage.toFixed(1)}★)`,
                    });
                } else if (c.voteAverage >= 7.5 && c.voteCount >= 200) {
                    baseScore += 6;
                }
                if (matchingPrefGenres.length > 0) baseScore += 6;
                if (matchesLanguage) baseScore += 4;
            } else {
                // explore: global top rated aligned with user preferences & history
                baseScore += (c.voteAverage / 10) * 24;
                if (c.voteAverage >= 8.0 && c.voteCount >= 500) {
                    baseScore += 8;
                    badges.push({
                        type: 'critical_acclaim',
                        label: `World Top Rated (${c.voteAverage.toFixed(1)}★)`,
                    });
                }
                if (matchingPrefGenres.length > 0 || matchingHistoryGenres.length > 0) {
                    baseScore += 14;
                    const gName = TMDB_GENRES[matchingPrefGenres[0] || matchingHistoryGenres[0]];
                    badges.push({
                        type: 'taste_match',
                        label: gName ? `Matches your ${gName} taste` : 'Matches your preferences',
                    });
                } else {
                    badges.push({
                        type: 'palate_cleanser',
                        label: 'Acclaimed World Cinema',
                    });
                }
                if (matchesLanguage) baseScore += 8;
            }

            if (badges.length === 0) {
                if (matchingPrefGenres.length > 0) {
                    badges.push({
                        type: 'taste_match',
                        label: `Matches ${TMDB_GENRES[matchingPrefGenres[0]] || 'your taste'}`,
                    });
                } else if (c.voteAverage >= 7.5) {
                    badges.push({
                        type: 'critical_acclaim',
                        label: `Rated ${c.voteAverage.toFixed(1)}★ worldwide`,
                    });
                }
            }

            // Seeded jitter (±6 points) ensures Regenerate surfaces fresh ordering while respecting quality
            const jitter = (rand() - 0.5) * 12;
            const finalScore = Math.min(99, Math.max(62, Math.round(baseScore + jitter)));

            return {
                tmdbId: c.tmdbId,
                title: c.title,
                mediaType: c.mediaType,
                posterPath: c.posterPath,
                backdropPath: c.backdropPath,
                overview: c.overview,
                releaseDate: c.releaseDate,
                voteAverage: c.voteAverage,
                voteCount: c.voteCount,
                score: finalScore,
                badges,
                genreNames: c.genreIds.map((g) => TMDB_GENRES[g]).filter(Boolean).slice(0, 3),
                suggestedBy: c.friendSuggestMeta || null,
            };
        };

        const freshPool = candidates.filter((c) => !excludeIds.has(c.tmdbId));
        const seenAgainPool = candidates.filter((c) => excludeIds.has(c.tmdbId));

        const rankedFresh = freshPool.map(scoreItem).sort((a, b) => b.score - a.score);
        if (rankedFresh.length >= targetCount) {
            return rankedFresh.slice(0, targetCount);
        }

        // If excludeIds filtered too many items on a small pool (e.g. small watchlist),
        // top up from remaining unwatched items so we still hit >= 10 when available
        const rankedRemainder = seenAgainPool.map(scoreItem).sort((a, b) => b.score - a.score);
        return [...rankedFresh, ...rankedRemainder].slice(0, targetCount);
    }

    async getSmartSuggestions(
        userId: string,
        modeOrOptions: SmartSuggestMode | 'critic' | SmartSuggestOptions = 'social',
        limitArg: number = 10
    ): Promise<SmartSuggestResponse> {
        const opts: SmartSuggestOptions =
            typeof modeOrOptions === 'string'
                ? { mode: modeOrOptions, limit: limitArg }
                : modeOrOptions;

        const mode = this.normalizeMode(opts.mode);
        const limit = Math.min(25, Math.max(10, opts.limit || 10));
        const excludeSet = new Set<number>(opts.excludeIds || []);
        const seed = opts.seed && Number.isFinite(opts.seed) ? opts.seed : Math.floor(Date.now() / 1000);

        try {
            const ctx = await this.getUserContext(userId);
            const { preferredGenreIds, preferredLanguages, topRatedEntries, lastWatchedEntry } =
                this.extractPreferenceProfile(ctx, opts.languages, opts.genres);

            // Extract genres from top-rated watch history anchor (fast, cached in TMDb)
            const historyGenreIds = new Set<number>();
            let lastWatchedGenre: string | null = null;
            if (lastWatchedEntry) {
                const anchorDetails = await this.fetchTmdbDetailsSafe(
                    lastWatchedEntry.tmdbId,
                    lastWatchedEntry.type === 'TV_SHOW' ? 'tv' : 'movie'
                );
                if (anchorDetails?.genres) {
                    for (const g of anchorDetails.genres) {
                        historyGenreIds.add(Number(g.id));
                    }
                    lastWatchedGenre = anchorDetails.genres[0]?.name || null;
                }
            }

            let candidateMap: Map<number, CandidateData>;
            if (mode === 'social') {
                candidateMap = await this.gatherSocialCandidates(ctx, preferredGenreIds, preferredLanguages, seed);
            } else if (mode === 'watchlist') {
                candidateMap = await this.gatherWatchlistCandidates(ctx, preferredGenreIds, seed);
            } else {
                candidateMap = await this.gatherExploreCandidates(
                    ctx,
                    preferredGenreIds,
                    preferredLanguages,
                    topRatedEntries,
                    seed
                );
            }

            // Final strict safety filter: NEVER return anything already watched or currently watching
            const safeCandidates = Array.from(candidateMap.values()).filter(
                (c) => !ctx.watchedOrWatchingIds.has(c.tmdbId)
            );

            const items = this.scoreAndRank(
                safeCandidates,
                mode,
                preferredGenreIds,
                preferredLanguages,
                historyGenreIds,
                excludeSet,
                limit,
                seed
            );

            return {
                mode,
                items,
                lastWatchedTitle: lastWatchedEntry?.title || null,
                lastWatchedGenre,
            };
        } catch (error) {
            console.error('[SmartSuggest] Engine Error:', error);
            return {
                mode,
                items: [],
                lastWatchedTitle: null,
                lastWatchedGenre: null,
            };
        }
    }
}

export const smartSuggestService = new SmartSuggestService();
