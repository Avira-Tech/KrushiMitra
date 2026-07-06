const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const PriceAlert = require('../models/PriceAlert');

// GET all alerts for user
router.get('/', protect, async (req, res) => {
  try {
    const alerts = await PriceAlert.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: alerts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create alert
router.post('/', protect, async (req, res) => {
  try {
    const { cropName, state, market, targetPrice, condition } = req.body;
    // Limit to 10 alerts per user
    const count = await PriceAlert.countDocuments({ user: req.user._id, isActive: true });
    if (count >= 10) {
      return res.status(400).json({ success: false, message: 'Max 10 active alerts allowed' });
    }
    const alert = await PriceAlert.create({
      user: req.user._id,
      cropName,
      state: state || '',
      market: market || '',
      targetPrice: Number(targetPrice),
      condition: condition || 'above',
    });
    res.status(201).json({ success: true, data: alert });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE alert
router.delete('/:id', protect, async (req, res) => {
  try {
    await PriceAlert.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ success: true, message: 'Alert deleted' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH toggle active
router.patch('/:id/toggle', protect, async (req, res) => {
  try {
    const alert = await PriceAlert.findOne({ _id: req.params.id, user: req.user._id });
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
    alert.isActive = !alert.isActive;
    await alert.save();
    res.json({ success: true, data: alert });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
