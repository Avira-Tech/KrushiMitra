const multer = require('multer');
const path = require('path');
const { sendError } = require('../utils/apiResponse');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }
  cb(new Error('Only images (JPEG, PNG, WebP) and documents (PDF, DOC) are allowed'));
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 10,
  },
  fileFilter,
});

// Middleware for single image
const uploadSingle = (fieldName = 'image') => upload.single(fieldName);

// Middleware for multiple images
const uploadMultiple = (fieldName = 'images', maxCount = 5) => upload.array(fieldName, maxCount);

// Middleware for mixed fields
const uploadFields = (fields) => upload.fields(fields);

module.exports = { upload, uploadSingle, uploadMultiple, uploadFields };
