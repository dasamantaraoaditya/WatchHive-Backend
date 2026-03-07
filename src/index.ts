import app from './app.js';
import { config } from './config.js';

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);

    try {
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
};

// Graceful shutdown signals
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    gracefulShutdown('SIGINT');
});

// Start the server
const serverPort = process.env.PORT || config.port || 8080;
app.listen(Number(serverPort), '0.0.0.0', () => {
    console.log(`\n🚀 WatchHive API Server`);
    console.log(`📡 Server running and listening on port ${serverPort}`);
    console.log(`🌍 Environment: ${config.nodeEnv}`);
    console.log(`💾 Database: Connected`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`   GET  /health`);
    console.log(`   POST /api/v1/auth/register`);
    console.log(`   POST /api/v1/auth/login`);
    console.log(`   POST /api/v1/auth/refresh`);
    console.log(`   POST /api/v1/auth/logout`);
    console.log(`\n✨ Ready to accept requests!\n`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('Unhandled Rejection');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('Uncaught Exception');
});

export default app;
