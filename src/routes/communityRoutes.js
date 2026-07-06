const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const User = require('../models/User');
const { ForumPost, ForumComment } = require('../models/Forum');

// ─── Favourites ────────────────────────────────────────────────────────────
// GET user's favourite farmers
router.get('/favourites', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('favouriteFarmers', 'name avatar rating isVerified address.state verificationStatus')
      .lean();
    res.json({ success: true, data: user?.favouriteFarmers || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST toggle favourite farmer
router.post('/favourites/:farmerId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const farmerId = req.params.farmerId;
    const favs = user.favouriteFarmers || [];
    const idx = favs.findIndex((f) => f.toString() === farmerId);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.push(farmerId);
    }
    user.favouriteFarmers = favs;
    await user.save();
    const isFav = idx < 0;
    res.json({ success: true, data: { isFavourite: isFav, farmerId } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET check if farmer is favourite
router.get('/favourites/:farmerId/check', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    const isFav = (user?.favouriteFarmers || []).some(
      (f) => f.toString() === req.params.farmerId,
    );
    res.json({ success: true, data: { isFavourite: isFav } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Community Forum ───────────────────────────────────────────────────────
// GET all posts
router.get('/forum', protect, async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (category && category !== 'all') filter.category = category;
    if (search) filter.$text = { $search: search };
    const posts = await ForumPost.find(filter)
      .populate('author', 'name avatar role rating verificationStatus')
      .sort({ isPinned: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();
    const total = await ForumPost.countDocuments(filter);
    res.json({ success: true, data: { posts, total, page: Number(page) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single post with comments
router.get('/forum/:id', protect, async (req, res) => {
  try {
    const post = await ForumPost.findByIdAndUpdate(
      req.params.id,
      { $inc: { viewCount: 1 } },
      { new: true },
    ).populate('author', 'name avatar role rating verificationStatus');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    const comments = await ForumComment.find({ post: req.params.id })
      .populate('author', 'name avatar role verificationStatus')
      .sort({ createdAt: 1 })
      .lean();
    res.json({ success: true, data: { post, comments } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create forum post
router.post('/forum', protect, async (req, res) => {
  try {
    const { title, content, category, tags, images } = req.body;
    const post = await ForumPost.create({
      author: req.user._id,
      title,
      content,
      category: category || 'general',
      tags: tags || [],
      images: images || [],
    });
    await post.populate('author', 'name avatar role verificationStatus');
    res.status(201).json({ success: true, data: post });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST add comment
router.post('/forum/:id/comments', protect, async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    const comment = await ForumComment.create({
      post: req.params.id,
      author: req.user._id,
      content: req.body.content,
      parentComment: req.body.parentComment || null,
    });
    await ForumPost.findByIdAndUpdate(req.params.id, { $inc: { commentCount: 1 } });
    await comment.populate('author', 'name avatar role verificationStatus');
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST upvote/downvote post
router.post('/forum/:id/vote', protect, async (req, res) => {
  try {
    const { type } = req.body; // 'up' or 'down'
    const post = await ForumPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    const uid = req.user._id.toString();
    // Remove from opposite
    if (type === 'up') {
      post.downvotes = post.downvotes.filter((u) => u.toString() !== uid);
      const idx = post.upvotes.findIndex((u) => u.toString() === uid);
      if (idx >= 0) post.upvotes.splice(idx, 1);
      else post.upvotes.push(req.user._id);
    } else {
      post.upvotes = post.upvotes.filter((u) => u.toString() !== uid);
      const idx = post.downvotes.findIndex((u) => u.toString() === uid);
      if (idx >= 0) post.downvotes.splice(idx, 1);
      else post.downvotes.push(req.user._id);
    }
    await post.save();
    res.json({ success: true, data: { upvotes: post.upvotes.length, downvotes: post.downvotes.length } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE forum post (own)
router.delete('/forum/:id', protect, async (req, res) => {
  try {
    const post = await ForumPost.findOne({ _id: req.params.id, author: req.user._id });
    if (!post) return res.status(404).json({ success: false, message: 'Not found or unauthorized' });
    await ForumComment.deleteMany({ post: req.params.id });
    await post.deleteOne();
    res.json({ success: true, message: 'Post deleted' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─── KYC ───────────────────────────────────────────────────────────────────
// GET KYC status
router.get('/kyc/status', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('verificationStatus aadhaarVerified gstVerified kycDocuments name phone')
      .lean();
    res.json({
      success: true,
      data: {
        verificationStatus: user?.verificationStatus || 'pending',
        aadhaarVerified: user?.aadhaarVerified || false,
        gstVerified: user?.gstVerified || false,
        kycDocuments: user?.kycDocuments || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Dispute Chatbot ──────────────────────────────────────────────────────
// POST chatbot message
router.post('/dispute-bot/message', protect, async (req, res) => {
  try {
    const { message, context } = req.body;
    const msg = (message || '').toLowerCase();

    // Simple rule-based chatbot for dispute resolution
    let response = '';
    let options = [];
    let step = context?.step || 'start';

    if (step === 'start' || msg.includes('help') || msg.includes('dispute')) {
      response = 'I\'m here to help you resolve your dispute. What is the issue you\'re facing?';
      options = ['Quality Problem', 'Payment not received', 'Delivery delay', 'Wrong quantity', 'Other issue'];
      step = 'issue_type';
    } else if (step === 'issue_type' || msg.includes('quality')) {
      if (msg.includes('quality') || msg.includes('payment') || msg.includes('delivery') || msg.includes('quantity') || msg.includes('other')) {
        response = 'I understand. Did you try contacting the other party directly via chat?';
        options = ['Yes, but no response', 'Yes, but couldn\'t agree', 'No, not yet', 'Submit formal dispute'];
        step = 'contact_attempt';
      } else {
        response = 'Please select one of the options above to continue.';
      }
    } else if (step === 'contact_attempt') {
      if (msg.includes('formal') || msg.includes('submit')) {
        response = '📋 To file a formal dispute:\n\n1. Go to your Contract\n2. Tap "Report Issue"\n3. Select the reason and add evidence (photos)\n4. Submit — our team reviews within 24-48 hours.\n\nDo you need help with anything else?';
        options = ['Guide me to Report Issue', 'Talk to Support', 'I\'m done'];
        step = 'formal_route';
      } else if (msg.includes('no response') || msg.includes('couldn\'t agree')) {
        response = 'In that case, you should file a formal dispute with evidence. This protects both parties and our team will mediate fairly.\n\nWould you like to file a formal dispute now?';
        options = ['Yes, file dispute', 'Contact support first', 'Wait longer'];
        step = 'formal_route';
      } else {
        response = 'We recommend trying to resolve it directly first — many issues get solved this way! Go to Chat and send a message to the other party.\n\nIf you can\'t resolve it, come back and I\'ll help you file a formal dispute.';
        options = ['I tried but need help', 'Ok, I\'ll try first'];
        step = 'contact_attempt';
      }
    } else if (step === 'formal_route') {
      if (msg.includes('support') || msg.includes('talk')) {
        response = '📞 Our support team is available:\n\n• Email: support@krushimitra.com\n• Chat: Use the Help Center\n• Response time: Within 4 hours\n\nIs there anything else I can help with?';
        options = ['Back to main menu', 'Close'];
        step = 'end';
      } else {
        response = 'Great! Here\'s what to do:\n\n✅ Collect evidence (photos, messages)\n✅ Go to the Contract screen\n✅ Tap "Report an Issue"\n✅ Fill the form with details\n\nOur team will review and resolve within 24-48 hours. Is there anything else?';
        options = ['Back to main menu', 'Close'];
        step = 'end';
      }
    } else {
      response = 'I\'m here to help! Please choose from the options or describe your issue.';
      options = ['Quality Problem', 'Payment Issue', 'Delivery Problem', 'Talk to Support'];
      step = 'start';
    }

    res.json({
      success: true,
      data: {
        message: response,
        options,
        step,
        timestamp: new Date(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
