const logger = require('./logger');

/**
 * Pagination helpers for consistent API responses
 */

/**
 * Build paginated response metadata
 */
const buildPaginationMeta = (total, page, limit, skip) => {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
  };
};

/**
 * Format paginated response
 */
const paginatedResponse = (data, total, page, limit) => {
  const skip = (page - 1) * limit;

  return {
    success: true,
    data,
    pagination: buildPaginationMeta(total, page, limit, skip),
  };
};

/**
 * Parse sort query parameter
 * Format: "fieldName:asc" or "fieldName:desc"
 */
const parseSortQuery = (sortQuery, allowedFields = []) => {
  if (!sortQuery) {
    return { createdAt: -1 };
  }

  const [field, order] = sortQuery.split(':');

  if (!field || !allowedFields.includes(field)) {
    return { createdAt: -1 };
  }

  return {
    [field]: order === 'asc' ? 1 : -1,
  };
};

/**
 * Parse and validate filter parameters
 */
const parseFilters = (queryFilters, allowedFilters = {}) => {
  const filters = {};

  for (const [key, value] of Object.entries(queryFilters)) {
    if (!allowedFilters[key]) continue;

    const filterConfig = allowedFilters[key];

    switch (filterConfig.type) {
      case 'string':
        // Regex search with escape
        filters[key] = { $regex: escapeRegex(value), $options: 'i' };
        break;

      case 'number':
        const num = parseFloat(value);
        if (!isNaN(num)) {
          filters[key] = num;
        }
        break;

      case 'enum':
        if (filterConfig.values.includes(value)) {
          filters[key] = value;
        }
        break;

      case 'boolean':
        filters[key] = value === 'true' || value === '1';
        break;

      case 'date':
        // Parse ISO date
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          filters[key] = { $gte: date };
        }
        break;

      case 'range':
        // Handle range: min:max format
        const [min, max] = value.split(':');
        if (min && !isNaN(parseFloat(min))) {
          filters[key] = { $gte: parseFloat(min) };
        }
        if (max && !isNaN(parseFloat(max))) {
          filters[key] = { ...filters[key], $lte: parseFloat(max) };
        }
        break;

      default:
        break;
    }
  }

  return filters;
};

/**
 * Safe escape for regex search
 */
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Build a complex query with filters, sort, and pagination
 */
const buildQuery = (queryParams, config = {}) => {
  const {
    allowedFilters = {},
    allowedSortFields = [],
    defaultLimit = 20,
    maxLimit = 100,
  } = config;

  const {
    page = 1,
    limit = defaultLimit,
    sortBy,
    order,
    ...filterParams
  } = queryParams;

  // Validate and cap limit
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(maxLimit, Math.max(1, parseInt(limit, 10) || defaultLimit));
  const skip = (parsedPage - 1) * parsedLimit;

  // Parse filters
  const filters = parseFilters(filterParams, allowedFilters);

  // Parse sort
  let sort = { createdAt: -1 };
  if (sortBy && allowedSortFields.includes(sortBy)) {
    sort = {
      [sortBy]: order === 'asc' ? 1 : -1,
    };
  }

  return {
    filters,
    sort,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      skip,
    },
  };
};

/**
 * Execute paginated query with error handling
 */
const executePaginatedQuery = async (query, options = {}) => {
  try {
    const { page = 1, limit = 20, skip = 0 } = options.pagination || {};

    const [data, total] = await Promise.all([
      query
        .skip(skip)
        .limit(limit)
        .sort(options.sort || { createdAt: -1 })
        .lean()
        .exec(),
      // Get count from the base query
      (async () => {
        if (query.model) {
          return query.model.countDocuments();
        }
        return 0;
      })(),
    ]);

    return paginatedResponse(data, total, page, limit);
  } catch (err) {
    logger.error('Paginated query error:', err.message);
    throw err;
  }
};

module.exports = {
  buildPaginationMeta,
  paginatedResponse,
  parseSortQuery,
  parseFilters,
  escapeRegex,
  buildQuery,
  executePaginatedQuery,
};
