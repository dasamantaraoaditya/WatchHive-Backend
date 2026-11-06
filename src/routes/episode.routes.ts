import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { episodeTrackingService } from '../services/episode-tracking.service.js';

const router = Router();

/**
 * @openapi
 * /api/v1/shows/{tmdbId}/episodes/watch:
 *   post:
 *     tags: [Episodes]
 *     summary: Mark or unmark an episode as watched
 *     security:
 *       - bearerAuth: []
 */
router.post('/shows/:tmdbId/episodes/watch', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user.id;
        const tmdbId = parseInt(req.params.tmdbId, 10);
        const {
            seasonNumber,
            episodeNumber,
            episodeId,
            episodeName,
            isWatched = true,
            rating,
            review,
            postToFeed = false,
        } = req.body;

        if (isNaN(tmdbId) || seasonNumber === undefined || episodeNumber === undefined) {
            res.status(400).json({ error: 'Valid tmdbId, seasonNumber, and episodeNumber are required' });
            return;
        }

        const progress = await episodeTrackingService.toggleEpisodeWatch({
            userId,
            tmdbId,
            seasonNumber: Number(seasonNumber),
            episodeNumber: Number(episodeNumber),
            episodeId: episodeId ? Number(episodeId) : undefined,
            episodeName,
            isWatched: Boolean(isWatched),
            rating: rating !== undefined ? Number(rating) : undefined,
            review,
            postToFeed: Boolean(postToFeed),
        });

        res.json({
            success: true,
            message: isWatched ? 'Episode marked as watched' : 'Episode unmarked',
            progress,
        });
    } catch (error: any) {
        console.error('Error toggling episode watch:', error);
        res.status(500).json({ error: error.message || 'Failed to update episode watch state' });
    }
});

/**
 * @openapi
 * /api/v1/shows/{tmdbId}/episodes/batch-catch-up:
 *   post:
 *     tags: [Episodes]
 *     summary: Catch up all episodes up to target season & episode
 *     security:
 *       - bearerAuth: []
 */
router.post('/shows/:tmdbId/episodes/batch-catch-up', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user.id;
        const tmdbId = parseInt(req.params.tmdbId, 10);
        const { upToSeason, upToEpisode } = req.body;

        if (isNaN(tmdbId) || upToSeason === undefined || upToEpisode === undefined) {
            res.status(400).json({ error: 'Valid tmdbId, upToSeason, and upToEpisode are required' });
            return;
        }

        const progress = await episodeTrackingService.batchCatchUp({
            userId,
            tmdbId,
            upToSeason: Number(upToSeason),
            upToEpisode: Number(upToEpisode),
        });

        res.json({
            success: true,
            message: `Successfully caught up to Season ${upToSeason}, Episode ${upToEpisode}`,
            progress,
        });
    } catch (error: any) {
        console.error('Error in batch catch-up:', error);
        res.status(500).json({ error: error.message || 'Failed to batch catch up episodes' });
    }
});

/**
 * @openapi
 * /api/v1/shows/{tmdbId}/progress:
 *   get:
 *     tags: [Episodes]
 *     summary: Get user's progress on a show
 *     security:
 *       - bearerAuth: []
 */
router.get('/shows/:tmdbId/progress', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user.id;
        const tmdbId = parseInt(req.params.tmdbId, 10);

        if (isNaN(tmdbId)) {
            res.status(400).json({ error: 'Invalid TMDb ID' });
            return;
        }

        const progress = await episodeTrackingService.getShowProgress(userId, tmdbId);
        res.json(progress);
    } catch (error: any) {
        console.error('Error fetching show progress:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch show progress' });
    }
});

/**
 * @openapi
 * /api/v1/users/me/continue-watching:
 *   get:
 *     tags: [Episodes]
 *     summary: Get all shows in progress with their next episode up
 *     security:
 *       - bearerAuth: []
 */
router.get('/users/me/continue-watching', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user.id;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 15;

        const items = await episodeTrackingService.getContinueWatching(userId, limit);
        res.json({ items });
    } catch (error: any) {
        console.error('Error fetching continue watching shows:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch continue watching shows' });
    }
});

/**
 * @openapi
 * /api/v1/shows/{tmdbId}/friends-progress:
 *   get:
 *     tags: [Episodes]
 *     summary: Get friends watching this show and their progress
 *     security:
 *       - bearerAuth: []
 */
router.get('/shows/:tmdbId/friends-progress', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user.id;
        const tmdbId = parseInt(req.params.tmdbId, 10);

        if (isNaN(tmdbId)) {
            res.status(400).json({ error: 'Invalid TMDb ID' });
            return;
        }

        const friends = await episodeTrackingService.getFriendsProgress(userId, tmdbId);
        res.json({ friends });
    } catch (error: any) {
        console.error('Error fetching friends progress:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch friends progress' });
    }
});

export default router;
