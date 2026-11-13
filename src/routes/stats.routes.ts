import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { entries } from '../db/schema.js';
import { eq, and, desc, sql, isNotNull } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware.js';
import tmdbService from '../services/tmdb.service.js';
import { TOP_GENRES, TopGenre, mapToTopGenres } from '../utils/genres.util.js';

const router = Router();

// In-memory process cache of `${type}-${tmdbId}` -> TopGenre[]
const tmdbGenreCache = new Map<string, TopGenre[]>();

/**
 * @openapi
 * /api/v1/stats/detailed:
 *   get:
 *     tags: [Stats]
 *     summary: Get detailed watch statistics for the current user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [MOVIE, TV_SHOW, EPISODE]
 *     responses:
 *       200:
 *         description: Detailed statistics including time series and distributions
 */
router.get('/detailed', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user.userId;
        const daysParam = parseInt(req.query.days as string);
        const days = isNaN(daysParam) ? 30 : daysParam;
        const typeFilter = req.query.type as string;
        const genreFilter = req.query.genre as string;
        const minRating = parseFloat(req.query.minRating as string) || 0;

        // 1. Build Base Conditions
        const conditions = [eq(entries.userId, userId)];

        if (days > 0) {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            conditions.push(sql`COALESCE(${entries.watchedAt}, ${entries.createdAt}) >= ${startDate.toISOString()}`);
        }

        if (typeFilter) conditions.push(eq(entries.type, typeFilter as any));
        if (minRating > 0) {
            conditions.push(isNotNull(entries.rating));
            conditions.push(sql`${entries.rating} >= ${minRating}`);
        }

        const whereClause = and(...conditions);

        // Helper to resolve canonical TMDb genres for an entry
        const resolveGenresForEntry = async (item: { tmdbId?: number | null; type?: string; tags?: string[] | null }): Promise<TopGenre[]> => {
            const fromTags = mapToTopGenres(item.tags);
            if (fromTags.length > 0) {
                return fromTags;
            }

            if (item.tmdbId) {
                const cacheKey = `${item.type || 'MOVIE'}-${item.tmdbId}`;
                if (tmdbGenreCache.has(cacheKey)) {
                    return tmdbGenreCache.get(cacheKey)!;
                }

                try {
                    let rawGenres: string[] = [];
                    if (item.type === 'TV_SHOW' || item.type === 'EPISODE') {
                        const tv = await tmdbService.getTVShowDetails(item.tmdbId);
                        rawGenres = (tv.genres || []).map((g: any) => g.name);
                    } else {
                        const movie = await tmdbService.getMovieDetails(item.tmdbId);
                        rawGenres = (movie.genres || []).map((g: any) => g.name);
                    }
                    const mapped = mapToTopGenres(rawGenres);
                    tmdbGenreCache.set(cacheKey, mapped);
                    return mapped;
                } catch {
                    tmdbGenreCache.set(cacheKey, []);
                }
            }

            return [];
        };

        // 2. Fetch Data for Aggregation (concurrent)
        const [userEntries, allUserEntries] = await Promise.all([
            db.select({
                id: entries.id,
                title: entries.title,
                type: entries.type,
                watchedAt: entries.watchedAt,
                createdAt: entries.createdAt,
                tags: entries.tags,
                rating: entries.rating,
                tmdbId: entries.tmdbId,
            })
                .from(entries)
                .where(whereClause)
                .orderBy(desc(sql`COALESCE(${entries.watchedAt}, ${entries.createdAt})`)),
            db.select({
                tags: entries.tags,
                tmdbId: entries.tmdbId,
                type: entries.type,
            }).from(entries).where(eq(entries.userId, userId))
        ]);

        // Resolve TMDb genres for user entries
        const userEntriesWithGenres = await Promise.all(
            userEntries.map(async (e) => ({
                ...e,
                resolvedGenres: await resolveGenresForEntry(e),
            }))
        );

        // Resolve genres for all user entries to calculate frequency
        const allUserEntriesGenres = await Promise.all(
            allUserEntries.map(async (e) => resolveGenresForEntry(e))
        );

        const genreFrequencyMap = new Map<TopGenre, number>();
        for (const g of TOP_GENRES) {
            genreFrequencyMap.set(g, 0);
        }
        allUserEntriesGenres.forEach(genresList => {
            genresList.forEach(g => {
                genreFrequencyMap.set(g, (genreFrequencyMap.get(g) || 0) + 1);
            });
        });

        // Top genres that user has watched, ordered by frequency, followed by remaining TOP_GENRES
        const userWatchedTopGenres = TOP_GENRES.filter(g => (genreFrequencyMap.get(g) || 0) > 0)
            .sort((a, b) => (genreFrequencyMap.get(b) || 0) - (genreFrequencyMap.get(a) || 0));
        const availableGenres = Array.from(new Set([...userWatchedTopGenres, ...TOP_GENRES]));

        // Filter by genre using resolved canonical TMDb top genres
        const filteredEntries = genreFilter 
            ? userEntriesWithGenres.filter(e => e.resolvedGenres.includes(genreFilter as TopGenre))
            : userEntriesWithGenres;

        // 3. Aggregate Time Series (Daily counts + Item lists)
        const timeSeriesMap = new Map<string, { count: number, items: any[] }>();
        const daysSpan = days > 0 ? days : 30;
        for (let i = 0; i < daysSpan; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            timeSeriesMap.set(d.toISOString().split('T')[0], { count: 0, items: [] });
        }

        filteredEntries.forEach(e => {
            const dateStr = (e.watchedAt ? new Date(e.watchedAt) : new Date(e.createdAt)).toISOString().split('T')[0];
            if (!timeSeriesMap.has(dateStr)) {
                timeSeriesMap.set(dateStr, { count: 0, items: [] });
            }
            const data = timeSeriesMap.get(dateStr)!;
            data.count++;
            data.items.push({ id: e.id, title: e.title, type: e.type, rating: e.rating, watchedAt: e.watchedAt });
        });

        const timeSeries = Array.from(timeSeriesMap.entries())
            .map(([date, data]) => ({ date, count: data.count, items: data.items }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // 4. Aggregate Type Breakdown
        const typeMap = new Map<string, number>();
        filteredEntries.forEach(e => {
            typeMap.set(e.type, (typeMap.get(e.type) || 0) + 1);
        });

        const typeBreakdown = Array.from(typeMap.entries())
            .map(([name, count]) => ({ name, count }));

        // 6. Basic Averages
        const ratings = filteredEntries
            .map(e => parseFloat(e.rating || '0'))
            .filter(r => r > 0);
        const averageRating = ratings.length > 0 
            ? parseFloat((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
            : 0;

        // 7. Viewing Rhythm (Hour of day distribution)
        // Group into 2-hour blocks for better visualization: 0-2, 2-4, ..., 22-24
        const rhythmMap = new Map<number, number>();
        for (let i = 0; i < 24; i += 4) rhythmMap.set(i, 0); // Initializing blocks

        filteredEntries.forEach(e => {
            if (!e.watchedAt) return;
            const hour = new Date(e.watchedAt).getHours();
            const block = Math.floor(hour / 4) * 4;
            rhythmMap.set(block, (rhythmMap.get(block) || 0) + 1);
        });

        const viewingRhythm = Array.from(rhythmMap.entries())
            .map(([hour, count]) => {
                let label = 'Late Night';
                if (hour >= 4 && hour < 8) label = 'Early Bird';
                else if (hour >= 8 && hour < 12) label = 'Morning';
                else if (hour >= 12 && hour < 16) label = 'Afternoon';
                else if (hour >= 16 && hour < 20) label = 'Evening';
                else if (hour >= 20 || hour < 4) label = 'Night Owl';
                return { hour, label, count };
            })
            .sort((a, b) => a.hour - b.hour);

        res.json({
            summary: {
                totalCount: filteredEntries.length,
                averageRating,
                daysAnalyzed: days
            },
            timeSeries,
            availableGenres,
            typeBreakdown,
            viewingRhythm
        });

    } catch (error) {
        console.error('Detailed stats error:', error);
        res.status(500).json({ error: 'Failed to fetch detailed statistics' });
    }
});

export default router;
