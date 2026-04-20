'use strict';
/**
 * money.js
 * 
 * Utility functions for handling currency in integer units (cents/paise).
 * Prevents floating point precision errors in financial calculations.
 */

/**
 * Convert a decimal amount (e.g., 220.50) to integer units (e.g., 22050).
 */
const toIntegerUnits = (amount) => {
  if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
  return Math.round(amount * 100);
};

/**
 * Convert integer units (e.g., 22050) back to decimal format (220.50).
 */
const fromIntegerUnits = (units) => {
  if (typeof units !== 'number') units = parseInt(units) || 0;
  return parseFloat((units / 100).toFixed(2));
};

module.exports = { toIntegerUnits, fromIntegerUnits };
