import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { entries } from '../db/schema.js';
import { eq, and, desc, gte } from 'drizzle-orm';
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

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // 1. Build Base Conditions
        const conditions = [
            eq(entries.userId, userId),
            gte(entries.watchedAt, startDate)
        ];

        if (typeFilter) {
            conditions.push(eq(entries.type, typeFilter as any));
        }

        const whereClause = and(...conditions);

        // 2. Fetch Data for Aggregation
        const userEntries = await db.select({
            id: entries.id,
            type: entries.type,
            watchedAt: entries.watchedAt,
            tags: entries.tags,
            rating: entries.rating,
        })
            .from(entries)
            .where(whereClause)
            .orderBy(desc(entries.watchedAt));

        // 3. Aggregate Time Series (Daily counts)
        const timeSeriesMap = new Map<string, number>();
        // Pre-fill last N days with zeros
        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            timeSeriesMap.set(d.toISOString().split('T')[0], 0);
        }

        userEntries.forEach(e => {
            const dateStr = new Date(e.watchedAt).toISOString().split('T')[0];
            if (timeSeriesMap.has(dateStr)) {
                timeSeriesMap.set(dateStr, (timeSeriesMap.get(dateStr) || 0) + 1);
            }
        });

        const timeSeries = Array.from(timeSeriesMap.entries())
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // 4. Aggregate Genre Breakdown
        const genreMap = new Map<string, number>();
        userEntries.forEach(e => {
            if (e.tags && Array.isArray(e.tags) && e.tags.length > 0) {
                const primaryGenre = e.tags[0];
                genreMap.set(primaryGenre, (genreMap.get(primaryGenre) || 0) + 1);
            }
        });

        const genreBreakdown = Array.from(genreMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // 5. Aggregate Type Breakdown
        const typeMap = new Map<string, number>();
        userEntries.forEach(e => {
            typeMap.set(e.type, (typeMap.get(e.type) || 0) + 1);
        });

        const typeBreakdown = Array.from(typeMap.entries())
            .map(([name, count]) => ({ name, count }));

        // 6. Basic Averages
        const ratings = userEntries
            .map(e => parseInt(e.rating || '0'))
            .filter(r => r > 0);
        const averageRating = ratings.length > 0 
            ? parseFloat((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
            : 0;

        res.json({
            summary: {
                totalCount: userEntries.length,
                averageRating,
                daysAnalyzed: days
            },
            timeSeries,
            genreBreakdown,
            typeBreakdown
        });

    } catch (error) {
        console.error('Detailed stats error:', error);
        res.status(500).json({ error: 'Failed to fetch detailed statistics' });
    }
});

export default router;
