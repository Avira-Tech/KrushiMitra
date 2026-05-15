'use strict';
const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { upload, validateFileMiddleware } = require('../middlewares/fileUpload');
const { uploadBufferToCloudinary } = require('../config/cloudinary');
const { sendSuccess, sendError } = require('../utils/apiResponse');

router.use(protect);

router.post('/', upload.single('file'), validateFileMiddleware, async (req, res) => {
  try {
    if (!req.file) {
      return sendError(res, { message: 'No file uploaded', statusCode: 400 });
    }

    const folder = req.body.folder || 'misc';
    const result = await uploadBufferToCloudinary(req.file.buffer, `krushimitra/${folder}`);

    return sendSuccess(res, {
      message: 'File uploaded successfully',
      data: {
        url: result.url,
        publicId: result.publicId,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
    });
  } catch (err) {
    return sendError(res, { message: err.message || 'Upload failed', statusCode: 500 });
  }
});

module.exports = router;
