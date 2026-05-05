/**
 * Standard API Response Utility
 * All responses follow: { success, message, data, meta }
 */

const sendSuccess = (res, { message = 'Success', data = {}, statusCode = 200, meta = null } = {}) => {
  const response = { success: true, message, data };
  if (meta) response.meta = meta;
  return res.status(statusCode).json(response);
};

const sendCreated = (res, { message = 'Created successfully', data = {} } = {}) => {
  return res.status(201).json({ success: true, message, data });
};

const sendError = (res, { message = 'An error occurred', statusCode = 500, errors = null } = {}) => {
  const response = { success: false, message };
  if (errors) response.errors = errors;
  return res.status(statusCode).json(response);
};

const sendNotFound = (res, message = 'Resource not found') => {
  return res.status(404).json({ success: false, message });
};

const sendUnauthorized = (res, message = 'Unauthorized access') => {
  return res.status(401).json({ success: false, message });
};

const sendForbidden = (res, message = 'Access forbidden') => {
  return res.status(403).json({ success: false, message });
};

const sendValidationError = (res, errors) => {
  return res.status(422).json({
    success: false,
    message: 'Validation failed',
    errors: Array.isArray(errors) ? errors : [errors],
  });
};

const sendPaginated = (res, { data, page, limit, total, message = 'Success' }) => {
  return res.status(200).json({
    success: true,
    message,
    data,
    meta: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
};

module.exports = {
  sendSuccess,
  sendCreated,
  sendError,
  sendNotFound,
  sendUnauthorized,
  sendForbidden,
  sendValidationError,
  sendPaginated,
};
