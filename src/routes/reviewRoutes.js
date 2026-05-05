const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { createReview, getUserReviews } = require('../controllers/reviewController');

router.get('/user/:userId', getUserReviews);
router.use(protect);
router.post('/', createReview);

module.exports = router;
