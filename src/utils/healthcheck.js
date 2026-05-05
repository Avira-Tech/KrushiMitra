'use strict';
/**
 * healthcheck.js
 * 
 * A lightweight HTTP client to check the backend's status.
 * Used by Docker HEALTHCHECK to verify the container is alive.
 */

const http = require('http');

const options = {
  host: 'localhost',
  port: process.env.PORT || 5000,
  path: '/health',
  timeout: 5000,
};

const request = http.request(options, (res) => {
  console.log(`Healthcheck status: ${res.statusCode}`);
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

request.on('error', (err) => {
  console.error(`Healthcheck failed: ${err.message}`);
  process.exit(1);
});

request.end();
