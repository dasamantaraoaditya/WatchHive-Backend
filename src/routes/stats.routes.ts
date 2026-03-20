import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { entries } from '../db/schema.js';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

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
        const days = parseInt(req.query.days as string) || 30;
        const typeFilter = req.query.type as string;
        const genreFilter = req.query.genre as string;
        const minRating = parseInt(req.query.minRating as string) || 0;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // 1. Build Base Conditions
        const conditions = [
            eq(entries.userId, userId),
            gte(entries.watchedAt, startDate)
        ];

        if (typeFilter) conditions.push(eq(entries.type, typeFilter as any));
        if (minRating > 0) conditions.push(gte(sql`CAST(${entries.rating} AS INTEGER)`, minRating));

        const whereClause = and(...conditions);

        // 2. Fetch Data for Aggregation
        const userEntries = await db.select({
            id: entries.id,
            title: entries.title,
            type: entries.type,
            watchedAt: entries.watchedAt,
            tags: entries.tags,
            rating: entries.rating,
        })
            .from(entries)
            .where(whereClause)
            .orderBy(desc(entries.watchedAt));

        // Filter by genre in memory if tag filter is provided
        const filteredEntries = genreFilter 
            ? userEntries.filter(e => e.tags && Array.isArray(e.tags) && e.tags.some(t => t.toLowerCase() === genreFilter.toLowerCase()))
            : userEntries;

        // 3. Aggregate Time Series (Daily counts + Item lists)
        const timeSeriesMap = new Map<string, { count: number, items: any[] }>();
        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            timeSeriesMap.set(d.toISOString().split('T')[0], { count: 0, items: [] });
        }

        filteredEntries.forEach(e => {
            const dateStr = new Date(e.watchedAt).toISOString().split('T')[0];
            if (timeSeriesMap.has(dateStr)) {
                const data = timeSeriesMap.get(dateStr)!;
                data.count++;
                data.items.push({ id: e.id, title: e.title, type: e.type, rating: e.rating });
            }
        });

        const timeSeries = Array.from(timeSeriesMap.entries())
            .map(([date, data]) => ({ date, count: data.count, items: data.items }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // 4. Aggregate Genre Breakdown (Top 20 for filters)
        const genreMap = new Map<string, number>();
        userEntries.forEach(e => {
            if (e.tags && Array.isArray(e.tags)) {
                e.tags.forEach(tag => genreMap.set(tag, (genreMap.get(tag) || 0) + 1));
            }
        });

        const availableGenres = Array.from(genreMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name);

        // 5. Aggregate Type Breakdown
        const typeMap = new Map<string, number>();
        filteredEntries.forEach(e => {
            typeMap.set(e.type, (typeMap.get(e.type) || 0) + 1);
        });

        const typeBreakdown = Array.from(typeMap.entries())
            .map(([name, count]) => ({ name, count }));

        // 6. Basic Averages
        const ratings = filteredEntries
            .map(e => parseInt(e.rating || '0'))
            .filter(r => r > 0);
        const averageRating = ratings.length > 0 
            ? parseFloat((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
            : 0;

        res.json({
            summary: {
                totalCount: filteredEntries.length,
                averageRating,
                daysAnalyzed: days
            },
            timeSeries,
            availableGenres,
            typeBreakdown
        });

    } catch (error) {
        console.error('Detailed stats error:', error);
        res.status(500).json({ error: 'Failed to fetch detailed statistics' });
    }
});

export default router;
