const axios = require('axios');
const nodemailer = require('nodemailer');
const dns = require('dns');
const logger = require('./logger');

// Force Node.js to prioritize IPv4
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

/**
 * Send email via Brevo (Sendinblue) API
 * This bypasses SMTP port blocks on platforms like Render.
 */
const sendEmailViaAPI = async (options) => {
  const apiKey = process.env.BREVO_API_KEY;
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'KrushiMitra', email: process.env.SMTP_USER },
        to: [{ email: options.to }],
        subject: options.subject,
        htmlContent: options.html || options.text,
      },
      {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
        },
      },
    );
    logger.info(`📧 Email sent via Brevo API: ${response.data.messageId}`);
    return response.data;
  } catch (error) {
    logger.error('❌ Brevo API Error:', error.response?.data || error.message);
    throw error;
  }
};

const transporterConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_PORT == 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false },
};

if (transporterConfig.host && transporterConfig.host.includes('gmail')) {
  delete transporterConfig.host;
  delete transporterConfig.port;
  delete transporterConfig.secure;
  transporterConfig.service = 'gmail';
}

const transporter = nodemailer.createTransport(transporterConfig);

const sendEmail = async (options) => {
  // If Brevo API Key is present, use API to bypass port blocks on Render
  if (process.env.BREVO_API_KEY) {
    return sendEmailViaAPI(options);
  }

  // Fallback to standard SMTP (Local development)
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
    logger.info(`📧 Email sent via SMTP: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('❌ SMTP Email sending failed:', error);
    throw error;
  }
};

module.exports = { sendEmail };
