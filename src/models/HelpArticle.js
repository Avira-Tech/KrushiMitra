const mongoose = require('mongoose');

const helpArticleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String, // Can be Markdown or plain text
    required: true
  },
  category: {
    type: String,
    enum: ['Payments', 'Farming', 'App Usage', 'Orders', 'Security', 'General'],
    default: 'General'
  },
  priority: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('HelpArticle', helpArticleSchema);
