import { Router, Request, Response } from 'express';
import tmdbService from '../services/tmdb.service.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

/**
 * @openapi
 * tags:
 *   name: TMDb
 *   description: Movie and TV show data from The Movie Database
 */

/**
 * @openapi
 * /api/v1/tmdb/search/movie:
 *   get:
 *     tags: [TMDb]
 *     summary: Search for movies
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Search results
 *       401:
 *         description: Unauthorized
 */
router.get('/search/movie', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { query, page } = req.query;

        if (!query || typeof query !== 'string') {
            res.status(400).json({ error: 'Query parameter is required' });
            return;
        }

        const pageNum = page ? parseInt(page as string, 10) : 1;
        const results = await tmdbService.searchMovies(query, pageNum);

        res.json(results);
    } catch (error) {
        console.error('Error searching movies:', error);
        res.status(500).json({ error: 'Failed to search movies' });
    }
});

/**
 * @openapi
 * /api/v1/tmdb/search/tv:
 *   get:
 *     tags: [TMDb]
 *     summary: Search for TV shows
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/search/tv', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { query, page } = req.query;

        if (!query || typeof query !== 'string') {
            res.status(400).json({ error: 'Query parameter is required' });
            return;
        }

        const pageNum = page ? parseInt(page as string, 10) : 1;
        const results = await tmdbService.searchTVShows(query, pageNum);

        res.json(results);
    } catch (error) {
        console.error('Error searching TV shows:', error);
        res.status(500).json({ error: 'Failed to search TV shows' });
    }
});

/**
 * @openapi
 * /api/v1/tmdb/search/multi:
 *   get:
 *     tags: [TMDb]
 *     summary: Search for both movies and TV shows
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/search/multi', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { query, page } = req.query;

        if (!query || typeof query !== 'string') {
            res.status(400).json({ error: 'Query parameter is required' });
            return;
        }

        const pageNum = page ? parseInt(page as string, 10) : 1;
        const results = await tmdbService.searchMulti(query, pageNum);

        res.json(results);
    } catch (error) {
        console.error('Error searching:', error);
        res.status(500).json({ error: 'Failed to search' });
    }
});

/**
 * @openapi
 * /api/v1/tmdb/movie/{id}:
 *   get:
 *     tags: [TMDb]
 *     summary: Get movie details by TMDb ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Movie details
 *       404:
 *         description: Movie not found
 */
router.get('/movie/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const movieId = parseInt(id, 10);

        if (isNaN(movieId)) {
            res.status(400).json({ error: 'Invalid movie ID' });
            return;
        }

        const movie = await tmdbService.getMovieDetails(movieId);
        if (!movie) {
            res.status(404).json({ error: 'Movie not found on TMDb' });
            return;
        }
        res.json(movie);
    } catch (error) {
        console.error('Error getting movie details:', error);
        res.status(500).json({ error: 'Failed to get movie details' });
    }
});

/**
 * @openapi
 * /api/v1/tmdb/tv/{id}:
 *   get:
 *     tags: [TMDb]
 *     summary: Get TV show details by TMDb ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: TV show details
 */
router.get('/tv/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const tvId = parseInt(id, 10);

        if (isNaN(tvId)) {
            res.status(400).json({ error: 'Invalid TV show ID' });
            return;
        }

        const tvShow = await tmdbService.getTVShowDetails(tvId);
        if (!tvShow) {
            res.status(404).json({ error: 'TV show not found on TMDb' });
            return;
        }
        res.json(tvShow);
    } catch (error) {
        console.error('Error getting TV show details:', error);
        res.status(500).json({ error: 'Failed to get TV show details' });
    }
});

/**
 * @openapi
 * /api/v1/tmdb/popular/movies:
 *   get:
 *     tags: [TMDb]
 *     summary: Get popular movies
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Popular movies list
 */
router.get('/popular/movies', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { page } = req.query;
        const pageNum = page ? parseInt(page as string, 10) : 1;
        const results = await tmdbService.getPopularMovies(pageNum);

        res.json(results);
    } catch (error) {
        console.error('Error getting popular movies:', error);
        res.status(500).json({ error: 'Failed to get popular movies' });
    }
});

/**
 * @openapi
 * /api/v1/tmdb/popular/tv:
 *   get:
 *     tags: [TMDb]
 *     summary: Get popular TV shows
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Popular TV shows list
 */
router.get('/popular/tv', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { page } = req.query;
        const pageNum = page ? parseInt(page as string, 10) : 1;
        const results = await tmdbService.getPopularTVShows(pageNum);

        res.json(results);
    } catch (error) {
        console.error('Error getting popular TV shows:', error);
        res.status(500).json({ error: 'Failed to get popular TV shows' });
    }
});

/**
 * @openapi
 * /api/v1/tmdb/trending/{mediaType}/{timeWindow}:
 *   get:
 *     tags: [TMDb]
 *     summary: Get trending movies/TV shows
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mediaType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [movie, tv, all]
 *       - in: path
 *         name: timeWindow
 *         required: true
 *         schema:
 *           type: string
 *           enum: [day, week]
 *     responses:
 *       200:
 *         description: Trending items list
 */
router.get('/trending/:mediaType/:timeWindow', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
        const { mediaType, timeWindow } = req.params;

        if (!['movie', 'tv', 'all'].includes(mediaType)) {
            res.status(400).json({ error: 'Invalid media type. Must be movie, tv, or all' });
            return;
        }

        if (!['day', 'week'].includes(timeWindow)) {
            res.status(400).json({ error: 'Invalid time window. Must be day or week' });
            return;
        }

        const results = await tmdbService.getTrending(
            mediaType as 'movie' | 'tv' | 'all',
            timeWindow as 'day' | 'week'
        );

        res.json(results);
    } catch (error) {
        console.error('Error getting trending:', error);
        res.status(500).json({ error: 'Failed to get trending' });
    }
});

export default router;
