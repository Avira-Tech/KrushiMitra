const express = require('express');
const router = express.Router();
const { getSchemes, getArticles } = require('../controllers/cmsController');

router.get('/schemes', getSchemes);
router.get('/articles', getArticles);

module.exports = router;
