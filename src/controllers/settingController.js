const SystemSetting = require('../models/SystemSetting');
const { sendSuccess, sendError } = require('../utils/apiResponse');

const { logAdminAction } = require('./adminController');

const getSettings = async (req, res) => {
  const settings = await SystemSetting.find();
  sendSuccess(res, { data: settings });
};

const updateSetting = async (req, res) => {
  let { key, value, description } = req.body;
  
  // Ensure numeric keys are stored as numbers
  if (key.includes('rate') || key.includes('limit') || key.includes('minimum') || key.includes('payout') || key.includes('gst')) {
    value = parseFloat(value);
    if (isNaN(value)) return sendError(res, { message: 'Value must be a number', statusCode: 400 });
  }

  const setting = await SystemSetting.findOneAndUpdate(
    { key },
    { value, description, updatedBy: req.user._id },
    { new: true, upsert: true }
  );
  
  await logAdminAction(req, 'Settings', 'UPDATE_SETTING', setting._id, { key, value });
  sendSuccess(res, { message: 'Setting updated successfully', data: setting });
};

module.exports = { getSettings, updateSetting };
