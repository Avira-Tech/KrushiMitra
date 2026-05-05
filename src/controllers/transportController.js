const Transport = require('../models/Transport');
const logger = require('../utils/logger');

exports.getAllTransports = async (req, res) => {
  try {
    const transports = await Transport.find().sort({ name: 1 });
    res.status(200).json({
      success: true,
      count: transports.length,
      data: transports
    });
  } catch (err) {
    logger.error('getAllTransports error: ' + err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch transport options' });
  }
};

exports.getTransport = async (req, res) => {
  try {
    const transport = await Transport.findById(req.params.id);
    if (!transport) {
      return res.status(404).json({ success: false, error: 'Transport option not found' });
    }
    res.status(200).json({ success: true, data: transport });
  } catch (err) {
    logger.error('getTransport error: ' + err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch transport details' });
  }
};

exports.createTransport = async (req, res) => {
  try {
    const transport = await Transport.create(req.body);
    res.status(201).json({ success: true, data: transport });
  } catch (err) {
    logger.error('createTransport error: ' + err.message);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Transport name already exists' });
    }
    res.status(500).json({ success: false, error: 'Failed to create transport option' });
  }
};

exports.updateTransport = async (req, res) => {
  try {
    const transport = await Transport.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });
    if (!transport) {
      return res.status(404).json({ success: false, error: 'Transport option not found' });
    }
    res.status(200).json({ success: true, data: transport });
  } catch (err) {
    logger.error('updateTransport error: ' + err.message);
    res.status(500).json({ success: false, error: 'Failed to update transport option' });
  }
};

exports.deleteTransport = async (req, res) => {
  try {
    const transport = await Transport.findByIdAndDelete(req.params.id);
    if (!transport) {
      return res.status(404).json({ success: false, error: 'Transport option not found' });
    }
    res.status(200).json({ success: true, data: {} });
  } catch (err) {
    logger.error('deleteTransport error: ' + err.message);
    res.status(500).json({ success: false, error: 'Failed to delete transport option' });
  }
};
