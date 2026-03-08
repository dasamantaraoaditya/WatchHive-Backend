import swaggerJsdoc from 'swagger-jsdoc';
import pkg from '../../package.json' with { type: 'json' };

const { version } = pkg;

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'WatchHive API Documentation',
            version,
            description: 'API documentation for the WatchHive backend services supporting social features for movie enthusiasts.',
            license: {
                name: 'MIT',
                url: 'https://spdx.org/licenses/MIT.html',
            },
            contact: {
                name: 'WatchHive Support',
                url: 'https://watchhive.com',
                email: 'support@watchhive.com',
            },
        },
        servers: [
            {
                url: 'http://localhost:5001',
                description: 'Development server',
            },
            {
                url: 'https://watchhive-api-production.up.railway.app',
                description: 'Production server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
    },
    apis: [
        './src/app.ts',
        './src/routes/*.ts',
        './dist/app.js',
        './dist/routes/*.js'
    ], // Path to the API docs
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
