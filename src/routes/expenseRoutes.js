const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const Expense = require('../models/Expense');

// GET all expenses for logged-in farmer
router.get('/', protect, async (req, res) => {
  try {
    const { month, year, category, cropId } = req.query;
    const filter = { farmer: req.user._id };
    if (category) filter.category = category;
    if (cropId) filter.cropId = cropId;
    if (month && year) {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59);
      filter.date = { $gte: start, $lte: end };
    }
    const expenses = await Expense.find(filter).sort({ date: -1 }).lean();
    const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
    const byCategory = expenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {});
    res.json({ success: true, data: { expenses, totalAmount, byCategory } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create expense
router.post('/', protect, async (req, res) => {
  try {
    const { category, title, amount, date, notes, cropId, cropName, receiptUrl } = req.body;
    const expense = await Expense.create({
      farmer: req.user._id,
      category,
      title,
      amount: Number(amount),
      date: date ? new Date(date) : new Date(),
      notes,
      cropId: cropId || null,
      cropName: cropName || '',
      receiptUrl: receiptUrl || '',
    });
    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT update expense
router.put('/:id', protect, async (req, res) => {
  try {
    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, farmer: req.user._id },
      req.body,
      { new: true },
    );
    if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });
    res.json({ success: true, data: expense });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE expense
router.delete('/:id', protect, async (req, res) => {
  try {
    await Expense.findOneAndDelete({ _id: req.params.id, farmer: req.user._id });
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET summary/analytics
router.get('/summary', protect, async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const expenses = await Expense.find({ farmer: req.user._id, date: { $gte: startOfYear } }).lean();
    const monthly = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      total: 0,
    }));
    expenses.forEach((e) => {
      const m = new Date(e.date).getMonth();
      monthly[m].total += e.amount;
    });
    const totalYear = expenses.reduce((s, e) => s + e.amount, 0);
    const byCategory = expenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {});
    res.json({ success: true, data: { monthly, totalYear, byCategory } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
