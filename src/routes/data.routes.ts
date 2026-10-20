import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { entries, lists, listItems } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware.js';
import tmdbService from '../services/tmdb.service.js';

const router = Router();

// ─── CSV Helpers ─────────────────────────────────────────────────────────────

function escapeCsvField(value: unknown): string {
    if (value === null || value === undefined) return '';
    let str = Array.isArray(value) ? value.join('|') : String(value);

    // Defend against CSV Formula Injection (CWE-1236): neutralize spreadsheet formula execution triggers
    if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
    }

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

// ─── IMPORT PREVIEW ──────────────────────────────────────────────────────────
// POST /api/v1/data/import/preview
// Body: { entries?: [...], lists?: [...] }

router.post('/import/preview', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user.userId;
        const body = req.body as { entries?: any[]; lists?: any[] };
        const rawEntries = Array.isArray(body.entries) ? body.entries : [];
        const rawLists = Array.isArray(body.lists) ? body.lists : [];

        // Fetch existing entries for current user to detect duplicates
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
        const existingTmdbIds = new Set(existingEntries.map(e => e.tmdbId));
        const seenInFile = new Set<string>();

        const previewEntries = [];
        const searchCache = new Map<string, any>();

        for (const rawItem of rawEntries) {
            const item: Record<string, any> = { ...rawItem };
            if (!item.title && item.name) item.title = item.name;
            if (!item.title || !String(item.title).trim()) continue;
            item.title = String(item.title).trim();

            // If tmdbId is already provided, mark matched
            if (item.tmdbId) {
                item.matchStatus = 'MATCHED';
                item.matchedTitle = item.matchedTitle || item.title;
                item.type = item.type || 'MOVIE';
            } else {
                let matched = false;

                // 1. Try finding by IMDb ID if available
                if (item.imdbId && typeof tmdbService.findByExternalId === 'function') {
                    try {
                        const findRes = await tmdbService.findByExternalId(item.imdbId);
                        const m = findRes?.movie_results?.[0];
                        const t = findRes?.tv_results?.[0];
                        if (m) {
                            item.tmdbId = m.id;
                            item.matchedTitle = m.title;
                            item.matchedYear = (m.release_date || '').slice(0, 4);
                            item.posterPath = m.poster_path;
                            item.type = 'MOVIE';
                            item.matchStatus = 'MATCHED';
                            matched = true;
                        } else if (t) {
                            item.tmdbId = t.id;
                            item.matchedTitle = t.name;
                            item.matchedYear = (t.first_air_date || '').slice(0, 4);
                            item.posterPath = t.poster_path;
                            item.type = 'TV_SHOW';
                            item.matchStatus = 'MATCHED';
                            matched = true;
                        }
                    } catch { /* ignore external ID error */ }
                }

                // 2. Try TMDb multi search (with cache)
                if (!matched) {
                    try {
                        const searchQuery = item.year ? `${item.title} ${item.year}` : item.title;
                        const cacheKey = `${searchQuery.toLowerCase().trim()}|${item.type || 'ANY'}`;
                        let top = searchCache.get(cacheKey);

                        if (top === undefined) {
                            const searchRes = await tmdbService.searchMulti(searchQuery);
                            if (searchRes?.results?.length > 0) {
                                const candidates = searchRes.results.filter(
                                    (r: any) => r.media_type === 'movie' || r.media_type === 'tv'
                                );
                                top = candidates.find((r: any) => {
                                    if (item.type === 'TV_SHOW') return r.media_type === 'tv';
                                    if (item.type === 'MOVIE') return r.media_type === 'movie';
                                    return true;
                                }) || candidates[0] || searchRes.results[0] || null;
                            } else {
                                top = null;
                            }
                            searchCache.set(cacheKey, top);
                        }

                        if (top) {
                            item.tmdbId = top.id;
                            item.matchedTitle = (top as any).title || (top as any).name;
                            item.matchedYear = ((top as any).release_date || (top as any).first_air_date || '').slice(0, 4);
                            item.posterPath = (top as any).poster_path || null;
                            if (!item.type) {
                                item.type = (top as any).media_type === 'tv' ? 'TV_SHOW' : 'MOVIE';
                            }
                            item.matchStatus = 'MATCHED';
                            matched = true;
                        }
                    } catch (e: any) {
                        console.warn(`TMDB multi search preview error for "${item.title}":`, e.message);
                    }
                }

                if (!matched) {
                    item.matchStatus = 'UNMATCHED';
                    item.tmdbId = null;
                }
            }

            // Duplicate detection check
            if (item.tmdbId) {
                const day = item.watchedAt ? new Date(item.watchedAt).toISOString().split('T')[0] : null;
                const fileKey = day ? `${item.tmdbId}|${day}` : `${item.tmdbId}|nodate`;

                if (day && existingKeys.has(`${item.tmdbId}|${day}`)) {
                    item.isDuplicate = true;
                    item.duplicateReason = 'Already in library on this date';
                } else if (!day && existingTmdbIds.has(Number(item.tmdbId))) {
                    item.isDuplicate = true;
                    item.duplicateReason = 'Already in your library';
                } else if (seenInFile.has(fileKey)) {
                    item.isDuplicate = true;
                    item.duplicateReason = 'Duplicate entry in file';
                } else {
                    item.isDuplicate = false;
                    seenInFile.add(fileKey);
                }
            }

            previewEntries.push(item);
        }

        const matchedCount = previewEntries.filter(e => e.matchStatus === 'MATCHED').length;
        const unmatchedCount = previewEntries.filter(e => e.matchStatus === 'UNMATCHED').length;
        const duplicateCount = previewEntries.filter(e => e.isDuplicate).length;
        const missingDateCount = previewEntries.filter(e => !e.watchedAt).length;

        return res.json({
            total: previewEntries.length,
            matchedCount,
            unmatchedCount,
            duplicateCount,
            missingDateCount,
            entries: previewEntries,
            lists: rawLists,
        });
    } catch (error) {
        console.error('Import preview error:', error);
        res.status(500).json({ error: 'Failed to preview import data' });
    }
});

function parseCsvToEntries(csvText: string): any[] {
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i].toLowerCase();
        if (l.includes('title') && (l.includes('tmdb') || l.includes('rating') || l.includes('type') || l.includes('watched') || l.includes('date'))) {
            headerIndex = i;
            break;
        }
    }
    if (headerIndex === -1) return [];

    const parseCsvRow = (row: string): string[] => {
        const result: string[] = [];
        let insideQuote = false;
        let entry = '';
        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            if (char === '"') {
                if (insideQuote && i + 1 < row.length && row[i + 1] === '"') {
                    entry += '"';
                    i++;
                } else {
                    insideQuote = !insideQuote;
                }
            } else if (char === ',' && !insideQuote) {
                result.push(entry);
                entry = '';
            } else {
                entry += char;
            }
        }
        result.push(entry);
        return result;
    };

    const headers = parseCsvRow(lines[headerIndex]).map(h => h.trim().toLowerCase());
    const entriesResult: any[] = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
        if (lines[i].startsWith('#')) break;
        const values = parseCsvRow(lines[i]);
        if (values.length < 2) continue;

        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx]?.trim() ?? '';
        });

        const title = row['title'] || row['name'] || '';
        if (!title) continue;

        const tmdbId = parseInt(row['tmdbid'] || row['tmdb_id'] || '0') || 0;
        const rawType = (row['type'] || 'MOVIE').toUpperCase();
        const type = rawType.includes('TV') ? 'TV_SHOW' : 'MOVIE';
        const rating = row['rating'] ? parseFloat(row['rating']) : null;
        const review = row['review'] || null;
        const tags = row['tags'] ? row['tags'].split('|').map(t => t.trim()).filter(Boolean) : [];
        const isRewatch = row['isrewatch'] === 'true' || row['is_rewatch'] === 'true';
        const isWatching = row['iswatching'] === 'true' || row['is_watching'] === 'true';
        const watchLocation = row['watchlocation'] || row['watch_location'] || null;
        const year = row['year'] || row['releaseyear'] || row['release year'] || null;

        // Date & Time: Date is mandatory; time falls back to 12:00:00 (midday) if omitted.
        const rawDate = row['watchedat'] || row['watched at'] || row['watched date'] || row['date'] || null;
        const rawTime = row['watchedtime'] || row['watched time'] || row['time'] || row['time watched'] || null;

        let watchedAt: string | null = null;
        if (rawDate) {
            let combined = rawDate;
            if (rawTime && !/T\d{2}:\d{2}/i.test(rawDate) && !/\b\d{1,2}:\d{2}\b/.test(rawDate)) {
                combined = `${rawDate} ${rawTime}`;
            }
            const d = new Date(combined);
            if (!isNaN(d.getTime())) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
                    watchedAt = new Date(`${rawDate}T12:00:00Z`).toISOString();
                } else {
                    if (d.getHours() === 0 && d.getMinutes() === 0 && !rawTime) {
                        d.setHours(12, 0, 0, 0);
                    }
                    watchedAt = d.toISOString();
                }
            }
        }

        entriesResult.push({
            tmdbId,
            title,
            year,
            type,
            rating,
            watchedAt,
            review,
            tags,
            isRewatch,
            isWatching,
            watchLocation,
            isImported: true,
        });
    }

    return entriesResult;
}

// ─── COMBINED IMPORT ─────────────────────────────────────────────────────────
// POST /api/v1/data/import
// Body: { entries?: [...], lists?: [...], csv?: string }

router.post('/import', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user.userId;
        const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as { entries?: any[]; lists?: any[]; csv?: string };

        if (body.csv && (!body.entries || body.entries.length === 0)) {
            body.entries = parseCsvToEntries(body.csv);
        }

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
            const existingTmdbIds = new Set(existingEntries.map(e => e.tmdbId));

            let imported = 0, skipped = 0;
            const errors: string[] = [];
            const validTypes = ['MOVIE', 'TV_SHOW', 'EPISODE'];

            for (const item of body.entries) {
                try {
                    if (!item.title && item.name) item.title = item.name;
                    if (!item.title || !String(item.title).trim()) {
                        errors.push(`Missing title for entry: ${JSON.stringify(item).slice(0, 60)}`);
                        skipped++;
                        continue;
                    }
                    item.title = String(item.title).trim();

                    // Normalize entry type
                    if (item.type) {
                        const tUpper = String(item.type).toUpperCase().trim();
                        if (tUpper === 'MOVIE' || tUpper === 'FILM') item.type = 'MOVIE';
                        else if (['TV_SHOW', 'TV', 'SERIES', 'SHOW', 'DRAMA', 'ANIME'].includes(tUpper)) item.type = 'TV_SHOW';
                        else if (tUpper === 'EPISODE') item.type = 'EPISODE';
                    }

                    // If tmdbId is missing, resolve it using TMDb search
                    if (!item.tmdbId) {
                        if (item.imdbId && typeof tmdbService.findByExternalId === 'function') {
                            try {
                                const findRes = await tmdbService.findByExternalId(item.imdbId);
                                const m = findRes?.movie_results?.[0];
                                const t = findRes?.tv_results?.[0];
                                if (m) {
                                    item.tmdbId = m.id;
                                    if (!item.type) item.type = 'MOVIE';
                                } else if (t) {
                                    item.tmdbId = t.id;
                                    if (!item.type) item.type = 'TV_SHOW';
                                }
                            } catch { /* ignore external lookup error */ }
                        }

                        if (!item.tmdbId) {
                            try {
                                const searchQuery = item.year ? `${item.title} ${item.year}` : item.title;
                                const searchRes = await tmdbService.searchMulti(searchQuery);
                                if (searchRes?.results?.length > 0) {
                                    const mediaCandidates = searchRes.results.filter(
                                        (r: any) => r.media_type === 'movie' || r.media_type === 'tv'
                                    );
                                    const match = mediaCandidates.find((r: any) => {
                                        if (item.type === 'TV_SHOW') return r.media_type === 'tv';
                                        if (item.type === 'MOVIE') return r.media_type === 'movie';
                                        return true;
                                    }) || mediaCandidates[0] || searchRes.results[0];

                                    if (match) {
                                        item.tmdbId = match.id;
                                        if (!item.type) {
                                            item.type = (match as any).media_type === 'tv' ? 'TV_SHOW' : 'MOVIE';
                                        }
                                    }
                                }
                            } catch (e: any) {
                                console.warn(`TMDB multi search error for "${item.title}":`, e.message);
                            }
                        }
                    }

                    if (!item.type) item.type = 'MOVIE';

                    if (!item.tmdbId) {
                        errors.push(`Could not match "${item.title}" on TMDb`);
                        skipped++;
                        continue;
                    }

                    if (!validTypes.includes(item.type)) {
                        item.type = 'MOVIE';
                    }

                    let watchedDate: Date = new Date();
                    let hasWatchedDate = false;
                    if (item.watchedAt) {
                        const parsed = new Date(item.watchedAt);
                        if (!isNaN(parsed.getTime())) {
                            watchedDate = parsed;
                            hasWatchedDate = true;
                        }
                    }

                    // Duplicate detection:
                    // 1. If watch date is provided: skip if already logged on that exact day
                    // 2. If no watch date is provided: skip if user already has this movie in their library
                    const day = hasWatchedDate ? watchedDate.toISOString().split('T')[0] : null;
                    const key = day ? `${item.tmdbId}|${day}` : `${item.tmdbId}|nodate`;

                    if (day && existingKeys.has(key)) {
                        skipped++;
                        continue;
                    }
                    if (!day && existingTmdbIds.has(Number(item.tmdbId))) {
                        skipped++;
                        continue;
                    }

                    let ratingVal: string | null = null;
                    if (item.rating != null && item.rating !== '') {
                        const parsedNum = parseFloat(String(item.rating));
                        if (!isNaN(parsedNum)) {
                            ratingVal = Math.min(10, Math.max(0, parsedNum)).toFixed(1);
                        }
                    }

                    let parsedStartedAt: Date | null = null;
                    if (item.startedAt) {
                        const d = new Date(item.startedAt);
                        if (!isNaN(d.getTime())) parsedStartedAt = d;
                    }

                    let parsedCompletedAt: Date | null = null;
                    if (item.completedAt) {
                        const d = new Date(item.completedAt);
                        if (!isNaN(d.getTime())) parsedCompletedAt = d;
                    }

                    let tagList: string[] = [];
                    if (Array.isArray(item.tags)) {
                        tagList = item.tags.map(String).filter(Boolean);
                    } else if (typeof item.tags === 'string' && item.tags.trim()) {
                        tagList = item.tags.split(/[,|]/).map((t: string) => t.trim()).filter(Boolean);
                    }
                    if (!tagList.includes('imported')) {
                        tagList.push('imported');
                    }

                    await db.insert(entries).values({
                        userId,
                        tmdbId: Number(item.tmdbId),
                        title: String(item.title),
                        type: item.type as any,
                        watchedAt: watchedDate,
                        rating: ratingVal,
                        review: item.review ? String(item.review) : null,
                        tags: tagList,
                        isRewatch: Boolean(item.isRewatch),
                        isWatching: Boolean(item.isWatching),
                        isImported: true,
                        startedAt: parsedStartedAt,
                        completedAt: parsedCompletedAt,
                        watchLocation: item.watchLocation ? String(item.watchLocation) : null,
                    });
                    if (day) existingKeys.add(key);
                    existingTmdbIds.add(Number(item.tmdbId));
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
                    if (!item.tmdbId && item.title) {
                        try {
                            const searchRes = await tmdbService.searchMulti(item.title);
                            const match = searchRes?.results?.[0];
                            if (match) item.tmdbId = match.id;
                        } catch { /* ignore */ }
                    }

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
