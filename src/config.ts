import dotenv from 'dotenv';

// Only load .env file in development — production platforms inject env vars directly
if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

const cleanEnv = (val?: string): string => {
    if (!val) return '';
    return val.trim().replace(/^["']|["']$/g, '');
};

const cleanPass = (val?: string): string => {
    if (!val) return '';
    return val.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
};

export const config = {
    port: process.env.PORT || 5001,
    nodeEnv: process.env.NODE_ENV || 'development',

    database: {
        url: process.env.DATABASE_URL!,
    },

    jwt: {
        secret: process.env.JWT_SECRET!,
        refreshSecret: process.env.JWT_REFRESH_SECRET!,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '90d',
    },

    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Supports comma-separated strings
    },

    tmdb: {
        apiKey: process.env.TMDB_API_KEY!,
        baseUrl: process.env.TMDB_BASE_URL || 'https://api.tmdb.org/3',
    },

    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
    },

    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },

    email: {
        from: cleanEnv(process.env.EMAIL_FROM) || 'watchershive@gmail.com',
        fromName: cleanEnv(process.env.EMAIL_FROM_NAME) || 'WatchersHive',
        sendgridApiKey: cleanEnv(process.env.SENDGRID_API_KEY),
        resendApiKey: cleanEnv(
            process.env.RESEND_API_KEY ||
            process.env.RESEND_KEY ||
            process.env.RESEND_TOKEN ||
            process.env.RESEND_APIKEY
        ),
        smtp: {
            host: cleanEnv(process.env.SMTP_HOST) || 'smtp.gmail.com',
            port: parseInt(cleanEnv(process.env.SMTP_PORT) || '587', 10),
            secure: cleanEnv(process.env.SMTP_SECURE) === 'true' || cleanEnv(process.env.SMTP_PORT) === '465',
            user: cleanEnv(process.env.SMTP_USER),
            pass: cleanPass(process.env.SMTP_PASS),
            service: cleanEnv(process.env.SMTP_SERVICE) || 'gmail',
        },
    },

    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
    },

    vapid: {
        publicKey: process.env.VAPID_PUBLIC_KEY || '',
        privateKey: process.env.VAPID_PRIVATE_KEY || '',
        subject: process.env.VAPID_SUBJECT || 'mailto:admin@watchhive.com',
    },

    firebase: {
        serviceAccountKey: process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT || '',
    },
};

// Validate required environment variables
const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}
