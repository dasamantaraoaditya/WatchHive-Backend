import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { lists, listItems, entries } from '../db/schema.js';
import { eq, and, desc, asc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// Get (or create) the default "Watchlist"
/**
 * @openapi
 * tags:
 *   name: Lists
 *   description: Custom watchlists and media collections
 */

/**
 * @openapi
 * /api/v1/lists/watchlist:
 *   get:
 *     tags: [Lists]
 *     summary: Get or create default watchlist
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's watchlist
 */
router.get('/watchlist', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.userId;

        // Try to find a list named "Watchlist" for this user
        let watchlist = await db.query.lists.findFirst({
            where: and(eq(lists.userId, userId), eq(lists.name, 'Watchlist')),
            with: {
                items: {
                    orderBy: desc(listItems.addedAt),
                },
            },
        });

        // If not found, create it
        if (!watchlist) {
            const [newList] = await db
                .insert(lists)
                .values({
                    userId,
                    name: 'Watchlist',
                    description: 'Movies and shows I plan to watch',
                    isPublic: true,
                })
                .returning();

            // Return with empty items for consistency
            watchlist = { ...newList, items: [] } as any;
        }

        res.json(watchlist);
    } catch (error) {
        console.error('Error fetching watchlist:', error);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

// Get all lists for the user
router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.userId;
        const userLists = await db.query.lists.findMany({
            where: eq(lists.userId, userId),
            orderBy: desc(lists.updatedAt),
        });
        res.json(userLists);
    } catch (error) {
        console.error('Error fetching lists:', error);
        res.status(500).json({ error: 'Failed to fetch lists' });
    }
});

// Create a new list
router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.userId;
        const { name, description, type, isPublic } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ error: 'Name is required' });
            return;
        }

        if (name.trim().length > 100) {
            res.status(400).json({ error: 'List name cannot exceed 100 characters' });
            return;
        }

        if (description && typeof description === 'string' && description.length > 1000) {
            res.status(400).json({ error: 'Description cannot exceed 1000 characters' });
            return;
        }

        const [newList] = await db
            .insert(lists)
            .values({
                userId,
                name: name.trim(),
                description: description ? String(description).trim() : null,
                type: type || 'WATCHLIST',
                isPublic: isPublic !== undefined ? isPublic : true,
            })
            .returning();

        res.status(201).json(newList);
    } catch (error) {
        console.error('Error creating list:', error);
        res.status(500).json({ error: 'Failed to create list' });
    }
});

/**
 * @openapi
 * /api/v1/lists/{listId}/items:
 *   post:
 *     tags: [Lists]
 *     summary: Add item to a list
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: listId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tmdbId
 *             properties:
 *               tmdbId:
 *                 type: integer
 *               mediaType:
 *                 type: string
 *                 default: movie
 *     responses:
 *       200:
 *         description: Item added
 *       404:
 *         description: List not found
 */
router.post('/:listId/items', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { listId } = req.params;
        const { tmdbId, mediaType } = req.body;
        const userId = req.user!.userId;

        // Verify list ownership
        const [list] = await db
            .select()
            .from(lists)
            .where(eq(lists.id, listId))
            .limit(1);

        if (!list) {
            res.status(404).json({ error: 'List not found' });
            return;
        }

        if (list.userId !== userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        // Check if item already exists
        const [existing] = await db
            .select()
            .from(listItems)
            .where(
                and(
                    eq(listItems.listId, listId),
                    eq(listItems.tmdbId, Number(tmdbId)),
                    eq(listItems.mediaType, mediaType || 'movie')
                )
            )
            .limit(1);

        if (existing) {
            res.status(400).json({ error: 'Item already in list' });
            return;
        }

        // Get max order index
        const [lastItem] = await db
            .select({ orderIndex: listItems.orderIndex })
            .from(listItems)
            .where(eq(listItems.listId, listId))
            .orderBy(desc(listItems.orderIndex))
            .limit(1);

        const [newItem] = await db
            .insert(listItems)
            .values({
                listId,
                tmdbId: Number(tmdbId),
                mediaType: mediaType || 'movie',
                orderIndex: lastItem ? lastItem.orderIndex + 1 : 0,
            })
            .returning();

        res.json(newItem);
    } catch (error) {
        console.error('Error adding to list:', error);
        res.status(500).json({ error: 'Failed to add item to list' });
    }
});

/**
 * @openapi
 * /api/v1/lists/{listId}/items/{tmdbId}:
 *   delete:
 *     tags: [Lists]
 *     summary: Remove item from a list
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: listId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: tmdbId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Removed
 */
router.delete('/:listId/items/:tmdbId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { listId, tmdbId } = req.params;
        const userId = req.user!.userId;

        const [list] = await db
            .select()
            .from(lists)
            .where(eq(lists.id, listId))
            .limit(1);

        if (!list || list.userId !== userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        // Find and delete the item by tmdbId
        const result = await db
            .delete(listItems)
            .where(
                and(
                    eq(listItems.listId, listId),
                    eq(listItems.tmdbId, Number(tmdbId))
                )
            )
            .returning();

        if (result.length === 0) {
            res.status(404).json({ error: 'Item not found in list' });
            return;
        }

        res.json({ message: 'Removed' });
    } catch (error) {
        console.error('Error removing from list:', error);
        res.status(500).json({ error: 'Failed to remove' });
    }
});

// Reorder items in a list
router.patch('/:listId/reorder', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { listId } = req.params;
        const { items } = req.body; // Array of { tmdbId: number, orderIndex: number }
        const userId = req.user!.userId;

        // Verify ownership
        const [list] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
        if (!list || list.userId !== userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        // Update each item's orderIndex
        await db.transaction(async (tx) => {
            for (const item of items) {
                await tx
                    .update(listItems)
                    .set({ orderIndex: item.orderIndex })
                    .where(
                        and(
                            eq(listItems.listId, listId),
                            eq(listItems.tmdbId, item.tmdbId)
                        )
                    );
            }
        });

        res.json({ message: 'Reordered successfully' });
    } catch (error) {
        console.error('Error reordering list:', error);
        res.status(500).json({ error: 'Failed to reorder list' });
    }
});

// Get ranked items with metadata and filters
router.get('/:listId/ranked', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { listId } = req.params;
        const { genre } = req.query;
        const userId = req.user!.userId;

        // Verify ownership (or publicity)
        const [list] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
        if (!list) {
            res.status(404).json({ error: 'List not found' });
            return;
        }

        // Support public lists for other users
        if (!list.isPublic && list.userId !== userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        // Fetch items joined with entries (to get genres/rating from local log if exists)
        // We use left join because user might rank movies they haven't logged yet
        const rankedItems = await db
            .select({
                tmdbId: listItems.tmdbId,
                mediaType: listItems.mediaType,
                orderIndex: listItems.orderIndex,
                addedAt: listItems.addedAt,
                // From entries
                localRating: entries.rating,
                localReview: entries.review,
                tags: entries.tags,
                watchedAt: entries.watchedAt,
                title: entries.title, // Fallback if entry exists
            })
            .from(listItems)
            .leftJoin(
                entries,
                and(
                    eq(listItems.tmdbId, entries.tmdbId),
                    eq(entries.userId, list.userId)
                )
            )
            .where(eq(listItems.listId, listId))
            .orderBy(asc(listItems.orderIndex));

        // Note: For movies without local entries, frontend will fetch metadata from TMDB.
        // For filtering, if we only have local metadata, we filter here.
        let filteredItems = rankedItems;

        if (genre) {
            filteredItems = filteredItems.filter(item => 
                item.tags?.some(tag => tag.toLowerCase().includes((genre as string).toLowerCase()))
            );
        }

        // If year or language filters are provided, they usually require TMDB data for un-logged movies.
        // For now, we'll return all and let frontend handle secondary filtering OR we could
        // fetch TMDB details for all items here (but that's slow without a cache).
        
        // We'll return the items and the frontend will supplement with TMDB data.
        res.json({
            list,
            items: filteredItems
        });
    } catch (error) {
        console.error('Error fetching ranked list:', error);
        res.status(500).json({ error: 'Failed to fetch ranked list' });
    }
});

// Update list name/details
router.patch('/:listId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.userId;
        const { listId } = req.params;
        const { name, description, isPublic } = req.body;

        if (name !== undefined) {
            if (typeof name !== 'string' || name.trim().length === 0) {
                res.status(400).json({ error: 'Name cannot be empty' });
                return;
            }
            if (name.trim().length > 100) {
                res.status(400).json({ error: 'List name cannot exceed 100 characters' });
                return;
            }
        }

        if (description !== undefined && description !== null && String(description).length > 1000) {
            res.status(400).json({ error: 'Description cannot exceed 1000 characters' });
            return;
        }

        const list = await db.query.lists.findFirst({
            where: and(eq(lists.id, listId), eq(lists.userId, userId))
        });

        if (!list) {
            res.status(404).json({ error: 'List not found or unauthorized' });
            return;
        }

        const [updatedList] = await db
            .update(lists)
            .set({
                name: name !== undefined ? String(name).trim() : list.name,
                description: description !== undefined ? (description ? String(description).trim() : null) : list.description,
                isPublic: isPublic !== undefined ? isPublic : list.isPublic,
                updatedAt: new Date()
            })
            .where(eq(lists.id, listId))
            .returning();

        res.json(updatedList);
    } catch (error) {
        console.error('Error updating list:', error);
        res.status(500).json({ error: 'Failed to update list' });
    }
});

// Delete a list
router.delete('/:listId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user!.userId;
        const { listId } = req.params;

        const list = await db.query.lists.findFirst({
            where: and(eq(lists.id, listId), eq(lists.userId, userId))
        });

        if (!list) {
            res.status(404).json({ error: 'List not found or unauthorized' });
            return;
        }

        if (list.type === 'WATCHLIST' && list.name === 'Watchlist') {
            res.status(400).json({ error: 'Default watchlist cannot be deleted' });
            return;
        }

        await db
            .delete(lists)
            .where(eq(lists.id, listId));

        res.json({ message: 'List deleted successfully' });
    } catch (error) {
        console.error('Error deleting list:', error);
        res.status(500).json({ error: 'Failed to delete list' });
    }
});

export default router;
