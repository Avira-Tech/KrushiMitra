const { sendError } = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * Middleware to validate pagination parameters
 * Prevents abuse through excessive data requests
 */
const validatePagination = (req, res, next) => {
  try {
    const { page = 1, limit = 20, skip } = req.query;

    // Parse and validate page
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    if (parsedPage > 10000) {
      return sendError(res, {
        message: 'Page number too high',
        statusCode: 400,
      });
    }

    // Parse and validate limit
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    if (parsedLimit < 1 || parsedLimit > 100) {
      return sendError(res, {
        message: 'Limit must be between 1 and 100',
        statusCode: 400,
      });
    }

    // Calculate skip
    const parsedSkip = (parsedPage - 1) * parsedLimit;
    if (parsedSkip > 1000000) {
      return sendError(res, {
        message: 'Offset too high',
        statusCode: 400,
      });
    }

    // Attach validated pagination to request
    req.pagination = {
      page: parsedPage,
      limit: parsedLimit,
      skip: parsedSkip,
    };

    next();
  } catch (err) {
    logger.error('Pagination validation error:', err.message);
    return sendError(res, {
      message: 'Invalid pagination parameters',
      statusCode: 400,
    });
  }
};

/**
 * Middleware to validate request body size for specific routes
 */
const validateRequestSize = (maxSizeKb = 100) => {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'], 10);

    if (!contentLength) {
      return next();
    }

    const maxBytes = maxSizeKb * 1024;

    if (contentLength > maxBytes) {
      logger.warn(`Request size exceeded: ${contentLength} bytes > ${maxBytes} bytes`);
      return sendError(res, {
        message: `Request body too large. Maximum ${maxSizeKb}KB allowed.`,
        statusCode: 413,
      });
    }

    next();
  };
};

/**
 * Middleware to validate sorting parameters
 */
const validateSort = (allowedFields = ['createdAt', 'updatedAt', 'name', 'price']) => {
  return (req, res, next) => {
    const { sortBy, order } = req.query;

    if (!sortBy && !order) {
      return next();
    }

    // Validate sort field
    if (sortBy && !allowedFields.includes(sortBy)) {
      return sendError(res, {
        message: `Invalid sort field. Allowed: ${allowedFields.join(', ')}`,
        statusCode: 400,
      });
    }

    // Validate sort order
    if (order && !['asc', 'desc'].includes(order)) {
      return sendError(res, {
        message: 'Sort order must be "asc" or "desc"',
        statusCode: 400,
      });
    }

    req.sort = {
      field: sortBy || 'createdAt',
      order: order === 'desc' ? -1 : 1,
    };

    next();
  };
};

/**
 * Middleware to validate numeric query parameters
 */
const validateNumericParams = (paramNames = []) => {
  return (req, res, next) => {
    for (const param of paramNames) {
      if (req.query[param] !== undefined) {
        const num = parseFloat(req.query[param]);

        if (isNaN(num)) {
          return sendError(res, {
            message: `${param} must be a valid number`,
            statusCode: 400,
          });
        }

        // Check for reasonable ranges
        if (Math.abs(num) > 1e10) {
          return sendError(res, {
            message: `${param} value is too large`,
            statusCode: 400,
          });
        }

        // Replace with parsed number
        req.query[param] = num;
      }
    }

    next();
  };
};

/**
 * Middleware to validate enum parameters
 */
const validateEnumParams = (paramEnumMap = {}) => {
  return (req, res, next) => {
    for (const [param, allowedValues] of Object.entries(paramEnumMap)) {
      if (req.query[param] && !allowedValues.includes(req.query[param])) {
        return sendError(res, {
          message: `${param} must be one of: ${allowedValues.join(', ')}`,
          statusCode: 400,
        });
      }
    }

    next();
  };
};

module.exports = {
  validatePagination,
  validateRequestSize,
  validateSort,
  validateNumericParams,
  validateEnumParams,
};
