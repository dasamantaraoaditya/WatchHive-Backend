import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import authRoutes from './routes/auth.routes.js';
import entriesRoutes from './routes/entries.js';
import tmdbRoutes from './routes/tmdb.routes.js';
import followsRoutes from './routes/follows.routes.js';
import likesRoutes from './routes/likes.routes.js';
import userRoutes from './routes/user.routes.js';
import feedRoutes from './routes/feed.routes.js';
import commentsRoutes from './routes/comments.routes.js';
import mindlensRoutes from './routes/mindlens.routes.js';
import listRoutes from './routes/lists.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import statsRoutes from './routes/stats.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Swagger Documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Security middleware — allow images from same origin
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS — allow both production URL and localhost for development
const allowedOrigins: string[] = [];
if (config.cors.origin) {
    // Support comma-separated origins in FRONTEND_URL
    const origins = config.cors.origin.split(',').map(o => o.trim());
    allowedOrigins.push(...origins);
}
if (config.nodeEnv === 'development') {
    allowedOrigins.push('http://localhost:3000', 'http://localhost:5173');
} else {
    // Also allow the backend's own production URL for Swagger UI
    allowedOrigins.push('https://watchhive-api-production.up.railway.app');
}

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (mobile apps, curl, etc.)
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error(`CORS: origin ${origin} not allowed`));
        },
        credentials: true,
    })
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (config.nodeEnv === 'development') {
    app.use(morgan('dev'));
}

import { checkDbHealth } from './db/index.js';

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Check API health status
 *     description: Returns the health status of the API and database connection.
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 database:
 *                   type: string
 *                   example: connected
 *                 environment:
 *                   type: string
 *                   example: production
 */
app.get('/health', async (_req, res) => {
    const isDbHealthy = await checkDbHealth();
    res.json({
        status: isDbHealthy ? 'ok' : 'error',
        database: isDbHealthy ? 'connected' : 'disconnected',
        environment: config.nodeEnv
    });
});

// Serve uploaded files statically
if (config.nodeEnv === 'development') {
    app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));
}

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/entries', entriesRoutes);
app.use('/api/v1/tmdb', tmdbRoutes);
app.use('/api/v1/follows', followsRoutes);
app.use('/api/v1/likes', likesRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/feed', feedRoutes);
app.use('/api/v1/comments', commentsRoutes);
app.use('/api/v1/mindlens', mindlensRoutes);
app.use('/api/v1/lists', listRoutes);
app.use('/api/v1/notifications', notificationsRoutes);
app.use('/api/v1/stats', statsRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

export default app;
