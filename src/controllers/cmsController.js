const GovtScheme = require('../models/GovtScheme');
const HelpArticle = require('../models/HelpArticle');
const { sendSuccess, sendError, sendNotFound } = require('../utils/apiResponse');
const { logAdminAction } = require('./adminController');

// Schemes
const getSchemes = async (req, res) => {
  const schemes = await GovtScheme.find().sort({ priority: -1, createdAt: -1 });
  sendSuccess(res, { data: schemes });
};

const upsertScheme = async (req, res) => {
  const { id } = req.params;
  const data = req.body;
  let scheme;
  if (id) {
    scheme = await GovtScheme.findByIdAndUpdate(id, data, { new: true });
  } else {
    scheme = await GovtScheme.create(data);
  }
  
  await logAdminAction(req, 'CMS', id ? 'UPDATE_SCHEME' : 'CREATE_SCHEME', scheme._id, { name: scheme.name });
  sendSuccess(res, { message: 'Scheme saved successfully', data: scheme });
};

const deleteScheme = async (req, res) => {
  const scheme = await GovtScheme.findByIdAndDelete(req.params.id);
  await logAdminAction(req, 'CMS', 'DELETE_SCHEME', req.params.id, { name: scheme?.name });
  sendSuccess(res, { message: 'Scheme deleted' });
};

// Help Articles
const getArticles = async (req, res) => {
  const { category } = req.query;
  const query = category ? { category, isActive: true } : { isActive: true };
  const articles = await HelpArticle.find(query).sort({ priority: -1, createdAt: -1 });
  sendSuccess(res, { data: articles });
};

const upsertArticle = async (req, res) => {
  const { id } = req.params;
  const data = req.body;
  let article;
  if (id) {
    article = await HelpArticle.findByIdAndUpdate(id, data, { new: true });
  } else {
    data.author = req.user._id;
    article = await HelpArticle.create(data);
  }
  
  await logAdminAction(req, 'CMS', id ? 'UPDATE_ARTICLE' : 'CREATE_ARTICLE', article._id, { title: article.title });
  sendSuccess(res, { message: 'Article saved successfully', data: article });
};

const deleteArticle = async (req, res) => {
  const article = await HelpArticle.findByIdAndDelete(req.params.id);
  await logAdminAction(req, 'CMS', 'DELETE_ARTICLE', req.params.id, { title: article?.title });
  sendSuccess(res, { message: 'Article deleted' });
};

module.exports = {
  getSchemes, upsertScheme, deleteScheme,
  getArticles, upsertArticle, deleteArticle
};
