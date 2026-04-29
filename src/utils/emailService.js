'use strict';
const nodemailer = require('nodemailer');
const logger = require('./logger');

/**
 * emailService.js
 * Utility to send emails using SMTP configuration from .env
 */

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_PORT == 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send an email
 * @param {Object} options - { to, subject, text, html, attachments }
 */
const sendEmail = async (options) => {
  try {
    const mailOptions = {
      from: `"KrushiMitra" <${process.env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`📧 Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('❌ Email sending failed:', error);
    throw error;
  }
};

module.exports = {
  sendEmail,
};
