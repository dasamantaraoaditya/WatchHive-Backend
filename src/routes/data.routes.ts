import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { entries, lists, listItems } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// ─── CSV Helpers ─────────────────────────────────────────────────────────────

function escapeCsvField(value: unknown): string {
    if (value === null || value === undefined) return '';
    const str = Array.isArray(value) ? value.join('|') : String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function rowToCsv(row: Record<string, unknown>): string {
    return Object.values(row).map(escapeCsvField).join(',');
}

// ─── Internal data fetchers ───────────────────────────────────────────────────

async function fetchUserEntries(userId: string) {
    return db
        .select({
            id: entries.id,
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
        })
        .from(entries)
        .where(eq(entries.userId, userId))
        .orderBy(entries.watchedAt);
}

async function fetchUserLists(userId: string) {
    return db.query.lists.findMany({
        where: eq(lists.userId, userId),
        with: { items: true },
        orderBy: lists.createdAt,
    });
}

/** Returns a Set of tmdbIds that appear in any of the user's lists */
async function fetchWatchlistTmdbIds(userId: string): Promise<Set<number>> {
    // Get all list IDs for user, then get all tmdbIds in those lists
    const userLists = await db
        .select({ id: lists.id })
        .from(lists)
        .where(eq(lists.userId, userId));

    if (userLists.length === 0) return new Set();

    const listIds = userLists.map(l => l.id);

    // Fetch all list items across all user lists
    const allItems = await Promise.all(
        listIds.map(lid =>
            db.select({ tmdbId: listItems.tmdbId }).from(listItems).where(eq(listItems.listId, lid))
        )
    );

    const set = new Set<number>();
    allItems.flat().forEach(item => set.add(item.tmdbId));
    return set;
}

// ─── COMBINED EXPORT ─────────────────────────────────────────────────────────
// GET /api/v1/data/export?include=entries,lists&format=json|csv

router.get('/export', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user.userId;
        const format = ((req.query.format as string) || 'json').toLowerCase();
        const includeParam = (req.query.include as string) || 'entries,lists';
        const include = includeParam.split(',').map(s => s.trim());
        const wantEntries = include.includes('entries');
        const wantLists = include.includes('lists');

        const timestamp = new Date().toISOString().split('T')[0];

        // Fetch watchlist tmdbId set (for inWatchlist field on entries)
        const watchlistIds = wantEntries ? await fetchWatchlistTmdbIds(userId) : new Set<number>();

        if (format === 'csv') {
            // CSV: export entries and/or lists as separate blobs merged with a blank separator
            const sections: string[] = [];

            if (wantEntries) {
                const userEntries = await fetchUserEntries(userId);
                const headers = [
                    'id', 'tmdbId', 'title', 'type', 'watchedAt', 'rating', 'review',
                    'tags', 'isRewatch', 'isWatching', 'startedAt', 'completedAt',
                    'watchLocation', 'inWatchlist', 'createdAt', 'updatedAt'
                ];
                const rows = [
                    '# WATCH ENTRIES',
                    headers.join(','),
                    ...userEntries.map(e => rowToCsv({
                        id: e.id,
                        tmdbId: e.tmdbId,
                        title: e.title,
                        type: e.type,
                        watchedAt: e.watchedAt?.toISOString() ?? '',
                        rating: e.rating ?? '',
                        review: e.review ?? '',
                        tags: e.tags ?? [],
                        isRewatch: e.isRewatch,
                        isWatching: e.isWatching,
                        startedAt: e.startedAt?.toISOString() ?? '',
                        completedAt: e.completedAt?.toISOString() ?? '',
                        watchLocation: e.watchLocation ?? '',
                        inWatchlist: watchlistIds.has(e.tmdbId),
                        createdAt: e.createdAt?.toISOString() ?? '',
                        updatedAt: e.updatedAt?.toISOString() ?? '',
                    }))
                ];
                sections.push(rows.join('\n'));
            }

            if (wantLists) {
                const userLists = await fetchUserLists(userId);
                const headers = ['listId', 'listName', 'listType', 'listDescription', 'isPublic', 'tmdbId', 'mediaType', 'orderIndex', 'addedAt'];
                const rows: string[] = ['# WATCH LISTS', headers.join(',')];
                for (const list of userLists) {
                    if (!list.items || list.items.length === 0) {
                        rows.push(rowToCsv({ listId: list.id, listName: list.name, listType: list.type, listDescription: list.description ?? '', isPublic: list.isPublic, tmdbId: '', mediaType: '', orderIndex: '', addedAt: '' }));
                    } else {
                        for (const item of list.items) {
                            rows.push(rowToCsv({ listId: list.id, listName: list.name, listType: list.type, listDescription: list.description ?? '', isPublic: list.isPublic, tmdbId: item.tmdbId, mediaType: item.mediaType, orderIndex: item.orderIndex, addedAt: (item.addedAt as Date)?.toISOString() ?? '' }));
                        }
                    }
                }
                sections.push(rows.join('\n'));
            }

            const filename = `watchhive_export_${timestamp}.csv`;
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(sections.join('\n\n'));
        }

        // JSON: single combined file
        const payload: Record<string, unknown> = {
            exportedAt: new Date().toISOString(),
            version: '1.0',
        };

        if (wantEntries) {
            const userEntries = await fetchUserEntries(userId);
            payload.entries = userEntries.map(e => ({
                ...e,
                inWatchlist: watchlistIds.has(e.tmdbId),
                watchedAt: e.watchedAt?.toISOString(),
                startedAt: e.startedAt?.toISOString() ?? null,
                completedAt: e.completedAt?.toISOString() ?? null,
                createdAt: e.createdAt?.toISOString(),
                updatedAt: e.updatedAt?.toISOString(),
            }));
        }

        if (wantLists) {
            const userLists = await fetchUserLists(userId);
            payload.lists = userLists.map(l => ({
                id: l.id,
                name: l.name,
                description: l.description,
                type: l.type,
                isPublic: l.isPublic,
                createdAt: (l.createdAt as Date)?.toISOString(),
                updatedAt: (l.updatedAt as Date)?.toISOString(),
                items: (l.items || []).map((item: any) => ({
                    tmdbId: item.tmdbId,
                    mediaType: item.mediaType,
                    orderIndex: item.orderIndex,
                    addedAt: (item.addedAt as Date)?.toISOString(),
                })),
            }));
        }

        const filename = `watchhive_export_${timestamp}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.json(payload);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// Legacy single-kind export: redirect to combined endpoint
router.get('/export/entries', authMiddleware, (req: Request, res: Response) => {
    req.query.include = 'entries';
    res.redirect(307, `/api/v1/data/export?include=entries&format=${req.query.format || 'json'}`);
});

router.get('/export/lists', authMiddleware, (req: Request, res: Response) => {
    req.query.include = 'lists';
    res.redirect(307, `/api/v1/data/export?include=lists&format=${req.query.format || 'json'}`);
});

// ─── COMBINED IMPORT ─────────────────────────────────────────────────────────
// POST /api/v1/data/import
// Body: { entries?: [...], lists?: [...] }

router.post('/import', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user.userId;
        const body = req.body as { entries?: any[]; lists?: any[] };

        const summary: Record<string, unknown> = { message: 'Import complete' };

        // ── Import Entries ────────────────────────────────────────────────────
        if (Array.isArray(body.entries) && body.entries.length > 0) {
            const existingEntries = await db
                .select({ tmdbId: entries.tmdbId, watchedAt: entries.watchedAt })
                .from(entries)
                .where(eq(entries.userId, userId));

            const existingKeys = new Set(
                existingEntries.map(e => {
                    const day = e.watchedAt ? new Date(e.watchedAt).toISOString().split('T')[0] : 'unknown';
                    return `${e.tmdbId}|${day}`;
                })
            );

            let imported = 0, skipped = 0;
            const errors: string[] = [];
            const validTypes = ['MOVIE', 'TV_SHOW', 'EPISODE'];

            for (const item of body.entries) {
                try {
                    if (!item.tmdbId || !item.title || !item.type) { errors.push(`Missing required fields: ${JSON.stringify(item).slice(0, 60)}`); skipped++; continue; }
                    if (!validTypes.includes(item.type)) { errors.push(`Invalid type "${item.type}" for "${item.title}"`); skipped++; continue; }

                    const watchedDate = item.watchedAt ? new Date(item.watchedAt) : new Date();
                    const key = `${item.tmdbId}|${watchedDate.toISOString().split('T')[0]}`;
                    if (existingKeys.has(key)) { skipped++; continue; }

                    await db.insert(entries).values({
                        userId,
                        tmdbId: Number(item.tmdbId),
                        title: String(item.title),
                        type: item.type as any,
                        watchedAt: watchedDate,
                        rating: item.rating != null ? String(item.rating) : null,
                        review: item.review ?? null,
                        tags: Array.isArray(item.tags) ? item.tags : [],
                        isRewatch: Boolean(item.isRewatch),
                        isWatching: Boolean(item.isWatching),
                        startedAt: item.startedAt ? new Date(item.startedAt) : null,
                        completedAt: item.completedAt ? new Date(item.completedAt) : null,
                        watchLocation: item.watchLocation ?? null,
                    });
                    existingKeys.add(key);
                    imported++;
                } catch (e: any) {
                    errors.push(`"${item.title || 'unknown'}": ${e.message}`);
                    skipped++;
                }
            }
            summary.entriesImported = imported;
            summary.entriesSkipped = skipped;
            if (errors.length) summary.entriesErrors = errors.slice(0, 20);
        }

        // ── Import Lists ──────────────────────────────────────────────────────
        if (Array.isArray(body.lists) && body.lists.length > 0) {
            const existingLists = await db.select({ id: lists.id, name: lists.name }).from(lists).where(eq(lists.userId, userId));
            const byName = new Map(existingLists.map(l => [l.name.toLowerCase(), l.id]));

            let listsImported = 0, listsSkipped = 0, itemsImported = 0, itemsSkipped = 0;

            for (const importList of body.lists) {
                if (!importList.name) { listsSkipped++; continue; }
                const nameKey = importList.name.toLowerCase();
                let listId: string;

                if (byName.has(nameKey)) {
                    listId = byName.get(nameKey)!;
                    listsSkipped++;
                } else {
                    const validTypes = ['WATCHLIST', 'RANKING_STACK', 'COLLECTION'];
                    const [newList] = await db.insert(lists).values({
                        userId,
                        name: importList.name,
                        description: importList.description ?? null,
                        type: (validTypes.includes(importList.type) ? importList.type : 'WATCHLIST') as any,
                        isPublic: importList.isPublic !== undefined ? Boolean(importList.isPublic) : true,
                    }).returning({ id: lists.id });
                    listId = newList.id;
                    byName.set(nameKey, listId);
                    listsImported++;
                }

                if (!Array.isArray(importList.items) || importList.items.length === 0) continue;

                const existingItems = await db.select({ tmdbId: listItems.tmdbId }).from(listItems).where(eq(listItems.listId, listId));
                const existingIds = new Set(existingItems.map(i => i.tmdbId));

                const [lastItem] = await db.select({ orderIndex: listItems.orderIndex }).from(listItems).where(eq(listItems.listId, listId)).orderBy(desc(listItems.orderIndex)).limit(1);
                let nextOrder = (lastItem?.orderIndex ?? -1) + 1;

                for (const item of importList.items) {
                    if (!item.tmdbId) { itemsSkipped++; continue; }
                    const tmdbId = Number(item.tmdbId);
                    if (existingIds.has(tmdbId)) { itemsSkipped++; continue; }
                    await db.insert(listItems).values({ listId, tmdbId, mediaType: item.mediaType || 'movie', orderIndex: item.orderIndex ?? nextOrder++ });
                    existingIds.add(tmdbId);
                    itemsImported++;
                }
            }
            summary.listsImported = listsImported;
            summary.listsSkipped = listsSkipped;
            summary.itemsImported = itemsImported;
            summary.itemsSkipped = itemsSkipped;
        }

        return res.json(summary);
    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ error: 'Failed to import data' });
    }
});

// Legacy single-kind import endpoints: delegate to the combined /import handler
router.post('/import/entries', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        const body = { entries: req.body.entries };
        req.body = body;
        // Re-use the same import logic inline
        return res.redirect(307, '/api/v1/data/import');
    } catch { res.status(500).json({ error: 'Failed' }); }
});

router.post('/import/lists', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        req.body = { lists: req.body.lists };
        return res.redirect(307, '/api/v1/data/import');
    } catch { res.status(500).json({ error: 'Failed' }); }
});

export default router;
