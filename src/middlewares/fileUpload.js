const multer = require('multer');
const sharp = require('sharp');
const logger = require('../utils/logger');

/**
 * Secure file upload middleware with validation
 */

// Allowed MIME types
const ALLOWED_MIMES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

// File size limits
const FILE_SIZE_LIMITS = {
  'image/jpeg': 5 * 1024 * 1024, // 5MB
  'image/png': 5 * 1024 * 1024,
  'image/webp': 5 * 1024 * 1024,
  'application/pdf': 10 * 1024 * 1024, // 10MB
};

// Signature bytes (magic numbers) to verify file type
const FILE_SIGNATURES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
  webp: [0x52, 0x49, 0x46, 0x46],
  pdf: [0x25, 0x50, 0x44, 0x46],
};

/**
 * Verify file signature (magic bytes)
 */
const verifyFileSignature = (buffer, mimeType) => {
  if (!buffer || buffer.length < 4) return false;

  const bytes = buffer.slice(0, 4);

  if (mimeType === 'image/jpeg') {
    return bytes[0] === FILE_SIGNATURES.jpeg[0] &&
           bytes[1] === FILE_SIGNATURES.jpeg[1] &&
           bytes[2] === FILE_SIGNATURES.jpeg[2];
  }

  if (mimeType === 'image/png') {
    return bytes[0] === FILE_SIGNATURES.png[0] &&
           bytes[1] === FILE_SIGNATURES.png[1] &&
           bytes[2] === FILE_SIGNATURES.png[2] &&
           bytes[3] === FILE_SIGNATURES.png[3];
  }

  if (mimeType === 'image/webp') {
    // WebP files start with RIFF
    return bytes[0] === FILE_SIGNATURES.webp[0] &&
           bytes[1] === FILE_SIGNATURES.webp[1] &&
           bytes[2] === FILE_SIGNATURES.webp[2] &&
           bytes[3] === FILE_SIGNATURES.webp[3];
  }

  if (mimeType === 'application/pdf') {
    return bytes[0] === FILE_SIGNATURES.pdf[0] &&
           bytes[1] === FILE_SIGNATURES.pdf[1] &&
           bytes[2] === FILE_SIGNATURES.pdf[2] &&
           bytes[3] === FILE_SIGNATURES.pdf[3];
  }

  return false;
};

/**
 * File filter for multer
 */
const fileFilter = (req, file, cb) => {
  // Validate MIME type
  if (!ALLOWED_MIMES[file.mimetype]) {
    return cb(new Error(`File type not allowed: ${file.mimetype}`));
  }

  // Validate filename
  if (!file.originalname || file.originalname.length > 255) {
    return cb(new Error('Invalid filename'));
  }

  // Check for suspicious characters
  if (!/^[\w\s.-]+$/.test(file.originalname)) {
    return cb(new Error('Filename contains invalid characters'));
  }

  cb(null, true);
};

/**
 * Multer storage configuration
 */
const storage = multer.memoryStorage();

/**
 * Create multer instance
 */
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 10,
  },
});

/**
 * Validate and process uploaded file
 */
const validateUploadedFile = async (file) => {
  if (!file) {
    throw new Error('No file provided');
  }

  // Verify file signature
  if (!verifyFileSignature(file.buffer, file.mimetype)) {
    throw new Error('File signature verification failed. Possible malicious file.');
  }

  // For images, verify with sharp
  if (file.mimetype.startsWith('image/')) {
    try {
      const metadata = await sharp(file.buffer).metadata();

      // Verify image dimensions are reasonable
      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid image dimensions');
      }

      if (metadata.width > 10000 || metadata.height > 10000) {
        throw new Error('Image dimensions too large');
      }

      // Verify format matches MIME type
      const allowedFormats = {
        'image/jpeg': ['jpeg'],
        'image/png': ['png'],
        'image/webp': ['webp'],
      };

      if (allowedFormats[file.mimetype] && !allowedFormats[file.mimetype].includes(metadata.format)) {
        throw new Error('Image format mismatch with MIME type');
      }

      return {
        valid: true,
        metadata,
        filename: `${Date.now()}-${file.originalname}`,
      };
    } catch (err) {
      logger.error('Image validation error:', err.message);
      throw new Error(`Invalid image file: ${err.message}`);
    }
  }

  // For PDFs, basic validation
  if (file.mimetype === 'application/pdf') {
    if (file.buffer.length < 100) {
      throw new Error('PDF file is too small');
    }

    return {
      valid: true,
      filename: `${Date.now()}-${file.originalname}`,
    };
  }

  return {
    valid: true,
    filename: `${Date.now()}-${file.originalname}`,
  };
};

/**
 * Optional: Sanitize image (reduce attack surface)
 */
const sanitizeImage = async (imageBuffer, format = 'jpeg') => {
  try {
    const sanitized = await sharp(imageBuffer)
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .rotate() // Auto-rotate based on EXIF (also removes EXIF data)
      [format]({ quality: 90 })
      .toBuffer();

    return sanitized;
  } catch (err) {
    logger.error('Image sanitization error:', err.message);
    throw err;
  }
};

/**
 * Middleware to validate uploaded files
 */
const validateFileMiddleware = async (req, res, next) => {
  try {
    if (!req.file) {
      return next();
    }

    const validation = await validateUploadedFile(req.file);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: 'File validation failed',
      });
    }

    req.file.validated = true;
    req.file.validatedFilename = validation.filename;
    req.file.validatedMetadata = validation.metadata;

    next();
  } catch (err) {
    logger.error('File validation middleware error:', err.message);
    return res.status(400).json({
      success: false,
      message: err.message || 'File validation failed',
    });
  }
};

module.exports = {
  upload,
  validateUploadedFile,
  validateFileMiddleware,
  sanitizeImage,
  ALLOWED_MIMES,
};
