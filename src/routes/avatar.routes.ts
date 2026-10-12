import { Router, Request, Response, NextFunction } from 'express';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Configure S3 client for Railway Buckets
const s3 = new S3Client({
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL, // Railway provides this
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
});

const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

/**
 * @openapi
 * /api/v1/avatars/{filename}:
 *   get:
 *     tags: [Avatars]
 *     summary: Stream public avatar image with caching
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Avatar image stream
 *       404:
 *         description: Avatar not found
 */
router.get('/:filename(*)', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const rawFilename = req.params.filename;
        if (!rawFilename) {
            return res.status(404).json({ error: 'Avatar not found' });
        }

        // Strip leading slashes, uploads, avatars prefixes
        let filename = rawFilename.replace(/^(\/?(uploads\/)?avatars\/|\/+)/, '');
        // Prevent path traversal attacks
        filename = path.basename(filename);

        if (!filename) {
            return res.status(404).json({ error: 'Avatar not found' });
        }

        const bucket = process.env.AWS_S3_BUCKET_NAME || 'watchhive-bucket-7zfstcmz';
        const key = `avatars/${filename}`;

        try {
            const command = new GetObjectCommand({
                Bucket: bucket,
                Key: key,
            });

            const s3Response = await s3.send(command);

            if (!s3Response.Body) {
                return res.status(404).json({ error: 'Avatar not found' });
            }

            // HTTP 304 Not Modified
            if (s3Response.ETag && req.headers['if-none-match'] === s3Response.ETag) {
                res.status(304).end();
                return;
            }

            const ext = path.extname(filename).toLowerCase();
            const contentType = s3Response.ContentType || mimeMap[ext] || 'image/jpeg';

            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800, immutable');
            if (s3Response.ETag) res.setHeader('ETag', s3Response.ETag);
            if (s3Response.ContentLength) res.setHeader('Content-Length', s3Response.ContentLength);

            if (typeof (s3Response.Body as any).pipe === 'function') {
                (s3Response.Body as Readable).pipe(res);
            } else {
                const bytes = await s3Response.Body.transformToByteArray();
                res.end(Buffer.from(bytes));
            }
            return;
        } catch (s3Err: any) {
            // Check local uploads directory as fallback (for legacy uploads)
            const localPath = path.resolve(__dirname, '../../uploads/avatars', filename);
            if (fs.existsSync(localPath)) {
                res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800, immutable');
                return res.sendFile(localPath);
            }

            if (s3Err.name === 'NoSuchKey' || s3Err.$metadata?.httpStatusCode === 404) {
                return res.status(404).json({ error: 'Avatar not found' });
            }
            console.error('S3 avatar fetch error for key', key, s3Err);
            return res.status(502).json({ error: 'Failed to retrieve avatar' });
        }
    } catch (error) {
        console.error('Avatar route error:', error);
        next(error);
    }
});

export default router;
