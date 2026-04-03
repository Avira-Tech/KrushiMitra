const Crop = require('../models/Crop');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');
const sanitizer = require('../utils/sanitizer');


const getCrops = async (req, res) => {
  try {
    const { category, search, minPrice, maxPrice, skip = 0, limit = 20, lat, lon, radius = 50 } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }
    if (minPrice || maxPrice) {
      filter.pricePerKg = {};
      if (minPrice) filter.pricePerKg.$gte = parseFloat(minPrice);
      if (maxPrice) filter.pricePerKg.$lte = parseFloat(maxPrice);
    }

    let crops;
    let total;

    // Separate execution paths to avoid $near + .sort() conflict
    if (lat && lon) {
      // 1. Geospatial Query Path
      const geoFilter = {
        ...filter,
        "location.coordinates": {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [parseFloat(lon), parseFloat(lat)], // Longitude first
            },
            $maxDistance: parseFloat(radius) * 1000, // km to meters
          },
        },
      };

      // MongoDB automatically sorts by distance here. NO .sort() allowed.
      crops = await Crop.find(geoFilter)
        .populate('farmer', 'name phone email location avatar rating')
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .lean();

      // Use basic filter for count to avoid $near count errors
      total = await Crop.countDocuments(filter);
    } else {
      // 2. Standard Query Path
      crops = await Crop.find(filter)
        .sort({ createdAt: -1 }) // Allowed here because $near is not used
        .populate('farmer', 'name phone email location avatar rating')
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .lean();

      total = await Crop.countDocuments(filter);
    }

    return res.status(200).json({
      success: true,
      data: crops,
      pagination: {
        total,
        skip: parseInt(skip),
        limit: parseInt(limit),
        pages: Math.ceil(total / (parseInt(limit) || 1)),
      },
    });
  } catch (error) {
    logger.error('❌ Error fetching crops:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};
/**
 * Get all crops with filters
 * GET /api/v1/crops
 */
// const getCrops = async (req, res) => {
//   try {
//     const { category, search, minPrice, maxPrice, skip = 0, limit = 20, lat, lon, radius = 50 } = req.query;

//     // Build filter
//     const filter = {};

//     if (category) {
//       filter.category = category;
//     }

//     if (search) {
//       filter.$or = [
//         { name: { $regex: search, $options: 'i' } },
//         { category: { $regex: search, $options: 'i' } },
//       ];
//     }

//     if (minPrice || maxPrice) {
//       filter.pricePerUnit = {};
//       if (minPrice) filter.pricePerUnit.$gte = parseFloat(minPrice);
//       if (maxPrice) filter.pricePerUnit.$lte = parseFloat(maxPrice);
//     }

//     // Geospatial query (if coordinates provided)
//     if (lat && lon) {
//       filter['location.coordinates'] = {
//         $near: {
//           $geometry: {
//             type: 'Point',
//             coordinates: [parseFloat(lon), parseFloat(lat)],
//           },
//           $maxDistance: parseFloat(radius) * 1000, // Convert km to meters
//         },
//       };
//     }

//     const crops = await Crop.find(filter)
//       .populate('farmer', 'name phone email location')
//       .sort({ createdAt: -1 })
//       .skip(parseInt(skip))
//       .limit(parseInt(limit));

//     const total = await Crop.countDocuments(filter);

//     return res.status(200).json({
//       success: true,
//       data: crops,
//       pagination: {
//         total,
//         skip: parseInt(skip),
//         limit: parseInt(limit),
//         pages: Math.ceil(total / parseInt(limit)),
//       },
//     });
//   } catch (error) {
//     logger.error('❌ Error fetching crops:', error);
//     return res.status(500).json({
//       success: false,
//       error: process.env.NODE_ENV === 'development' ? error.message : 'Failed to fetch crops',
//     });
//   }
// };

/**
 * Get crop detail
 * GET /api/v1/crops/:id
 */
const getCropDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const crop = await Crop.findById(id)
      .populate('farmer', 'name phone email location avatar rating')
      .populate('reviews', 'rating comment reviewer')
      .lean();

    if (!crop) {
      return res.status(404).json({
        success: false,
        error: 'Crop not found',
      });
    }

    // Get farmer's other crops
    const otherCrops = await Crop.find(
      { farmer: crop.farmer._id, _id: { $ne: id } },
      'name category pricePerUnit images'
    ).limit(5);

    return res.status(200).json({
      success: true,
      data: {
        ...crop,
        farmerOtherCrops: otherCrops,
      },
    });
  } catch (error) {
    logger.error('❌ Error fetching crop detail:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch crop details',
    });
  }
};

/**
 * Add new crop
 * POST /api/v1/crops
 */
// const addCrop = async (req, res) => {
//   try {
//     // Validate input
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({
//         success: false,
//         errors: errors.array().map(e => ({
//           field: e.param,
//           message: e.msg,
//         })),
//       });
//     }

//     const userId = req.user.id; // From auth middleware
//     const {
//       name,
//       category,
//       quantity,
//       unit,
//       pricePerKg,
//       quality,
//       description,
//       harvestDate,
//       images,
//       location,
//       soilType,
//       pesticides,
//     } = req.body;

//     // Verify user exists and is a farmer
//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         error: 'User not found',
//       });
//     }

//     if (user.role !== 'farmer') {
//       return res.status(403).json({
//         success: false,
//         error: 'Only farmers can add crops',
//       });
//     }

//     // Sanitize inputs
//     const sanitized = {
//       name: sanitizer.sanitizeString(name),
//       category: sanitizer.sanitizeString(category),
//       pricePerKg: parseFloat(pricePerKg),
//       quality: quality || 'A',
//       description: sanitizer.sanitizeString(description),
//       soilType: sanitizer.sanitizeString(soilType),
//       quantity: parseFloat(quantity),
//       unit,
//       pricePerUnit: parseFloat(pricePerUnit),
//       harvestDate: new Date(harvestDate),
//       images: images.map(img => sanitizer.sanitizeUrl(img)),
//       location: {
//         type: 'Point',
//         coordinates: [parseFloat(location.longitude), parseFloat(location.latitude)],
//         address: sanitizer.sanitizeString(location.address),
//       },
//       pesticides: Boolean(pesticides),
//     };

//     // Create crop
//     const crop = new Crop({
//       ...sanitized,
//       farmer: userId,
//       availableQuantity: sanitized.quantity,
//     });

//     await crop.save();

//     // Populate farmer info
//     await crop.populate('farmer', 'name phone email');

//     logger.info(`✅ Crop added by farmer ${userId}:`, crop._id);

//     return res.status(201).json({
//       success: true,
//       message: 'Crop added successfully',
//       data: crop,
//     });
//   } catch (error) {
//     logger.error('❌ Error adding crop:', error);
//     return res.status(500).json({
//       success: false,
//       error: process.env.NODE_ENV === 'development' ? error.message : 'Failed to add crop',
//     });
//   }
// };

const addCrop = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        // This will now correctly report the 'pricePerKg' or 'category' errors
        errors: errors.array().map(e => ({ field: e.param, message: e.msg })),
      });
    }

    const {
      name, category, quantity, unit, pricePerKg, quality,
      description, harvestDate, images, location, soilType, pesticides
    } = req.body;

    const crop = new Crop({
      farmer: req.user.id,
      name: sanitizer.sanitizeString(name),
      category: category, 
      quantity: parseFloat(quantity),
      quantityUnit: unit || 'kg',
      pricePerKg: parseFloat(pricePerKg),
      quality: quality || 'A',
      description: sanitizer.sanitizeString(description),
      harvestDate: new Date(harvestDate),
      images: images, 
      location: {
        type: 'Point',
        coordinates: [parseFloat(location.longitude), parseFloat(location.latitude)],
        address: sanitizer.sanitizeString(location.address),
      },
      soilType,
      pesticides: Boolean(pesticides),
    });

    await crop.save();
    res.status(201).json({ success: true, data: crop });
  } catch (error) {
    logger.error('Error adding crop:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update crop
 * PUT /api/v1/crops/:id
 */
const updateCrop = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { id } = req.params;
    const userId = req.user.id; // From auth middleware
    const updates = req.body;

    // Find crop
    const crop = await Crop.findById(id);
    if (!crop) {
      return res.status(404).json({
        success: false,
        error: 'Crop not found',
      });
    }

    // ✅ AUTH CHECK: Verify farmer owns this crop
    if (crop.farmer.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only update your own crops',
      });
    }

    // ✅ Prevent updating farmer & createdAt
    delete updates.farmer;
    delete updates.createdAt;
    delete updates._id;

    // Sanitize updates
    const sanitizedUpdates = {};
    const allowedFields = [
      'name',
      'category',
      'quantity',
      'unit',
      'pricePerUnit',
      'description',
      'harvestDate',
      'images',
      'soilType',
      'pesticides',
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field === 'quantity') {
          sanitizedUpdates[field] = parseFloat(updates[field]);
          sanitizedUpdates.availableQuantity = parseFloat(updates[field]);
        } else if (field === 'pricePerUnit') {
          sanitizedUpdates[field] = parseFloat(updates[field]);
        } else if (['name', 'category', 'description', 'soilType'].includes(field)) {
          sanitizedUpdates[field] = sanitizer.sanitizeString(updates[field]);
        } else if (field === 'images') {
          sanitizedUpdates[field] = updates[field].map(img => sanitizer.sanitizeUrl(img));
        } else {
          sanitizedUpdates[field] = updates[field];
        }
      }
    }

    // Update crop
    const updatedCrop = await Crop.findByIdAndUpdate(
      id,
      sanitizedUpdates,
      { new: true, runValidators: true }
    ).populate('farmer', 'name phone email');

    logger.info(`✅ Crop updated by farmer ${userId}:`, id);

    return res.status(200).json({
      success: true,
      message: 'Crop updated successfully',
      data: updatedCrop,
    });
  } catch (error) {
    logger.error('❌ Error updating crop:', error);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message : 'Failed to update crop',
    });
  }
};

/**
 * Delete crop
 * DELETE /api/v1/crops/:id
 */
const deleteCrop = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const crop = await Crop.findById(id);
    if (!crop) {
      return res.status(404).json({
        success: false,
        error: 'Crop not found',
      });
    }

    // ✅ AUTH CHECK: Verify farmer owns this crop
    if (crop.farmer.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own crops',
      });
    }

    // Check if crop has active offers
    const Offer = require('../models/Offer');
    const activeOffers = await Offer.countDocuments({
      crop: id,
      status: { $in: ['pending', 'accepted'] },
    });

    if (activeOffers > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete crop with active offers',
      });
    }

    await Crop.findByIdAndDelete(id);

    logger.info(`✅ Crop deleted by farmer ${userId}:`, id);

    return res.status(200).json({
      success: true,
      message: 'Crop deleted successfully',
    });
  } catch (error) {
    logger.error('❌ Error deleting crop:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete crop',
    });
  }
};

/**
 * Get farmer's crops
 * GET /api/v1/crops/farmer/my-listings
 */
const getFarmerCrops = async (req, res) => {
  try {
    const farmerId = req.user.id;
    const { skip = 0, limit = 20 } = req.query;

    const crops = await Crop.find({ farmer: farmerId })
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await Crop.countDocuments({ farmer: farmerId });

    return res.status(200).json({
      success: true,
      data: crops,
      pagination: {
        total,
        skip: parseInt(skip),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    logger.error('❌ Error fetching farmer crops:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch your crops',
    });
  }
};

module.exports = {
  getCrops,
  getCropDetail,
  addCrop,
  updateCrop,
  deleteCrop,
  getFarmerCrops,
};
