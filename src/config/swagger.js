const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'KrushiMitra API',
      version: '1.0.0',
      description: 'API documentation for the KrushiMitra Smart Agriculture Platform',
      contact: {
        name: 'KrushiMitra Support',
        email: 'support@krushimitra.com',
      },
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:5000/api/v1',
        description: 'Primary API Server',
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
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.js', './src/models/*.js'], // Files containing annotations
};

const specs = swaggerJsdoc(options);

module.exports = specs;
