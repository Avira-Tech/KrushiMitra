const { GoogleGenAI } = require('@google/genai');
const logger = require('../utils/logger');

const aiConfig = {
  apiKey: process.env.GEMINI_API_KEY || 'MISSING_API_KEY',
};

const ai = new GoogleGenAI(aiConfig);

/**
 * Project Context for the AI Support Assistant
 */
const PROJECT_CONTEXT = `
You are the KrushiMitra AI Support Assistant, a helpful and expert guide for the KrushiMitra platform.
KrushiMitra is a comprehensive digital ecosystem designed to empower Indian farmers and connect them directly with buyers.

Key Features & Functionality:
1. Marketplace: Farmers can list their crops with images, descriptions, and prices. Buyers can browse, filter, and purchase these crops.
2. Direct Trade: Eliminates middlemen, ensuring farmers get better prices and buyers get fresh produce.
3. AI Price Prediction: Uses market data (Mandi prices) and crop quality to suggest the best competitive listing price for farmers.
4. Escrow Payment System: Powered by Stripe. When a buyer pays, the money is held securely. It is only released to the farmer after the buyer confirms successful delivery.
5. Integrated Logistics: Supports various delivery types including village-to-city and intercity transport. Uses porter-style services.
6. Real-time Communication: Integrated chat system with Voice and Video calling (powered by Agora) for negotiations and coordination.
7. Mandi Price Tracking: Real-time price updates from various Indian Mandis (markets) to help users make informed decisions.
8. Weather Updates: Hyper-local weather forecasting for farmers.
9. Contract Management: Formalizes every trade with a contract that tracks status (Pending, Paid, In-Transit, Delivered, Completed).
10. Reviews & Ratings: Users can rate each other after deals to build a trusted community.

Application Navigation:
- Home: Dashboard with quick links to crops, weather, and market trends.
- Market: Browse all available crop listings.
- Chat: Direct messages and the Support Assistant (You!).
- Profile: Manage account, view trade history, and access help.
- Support Button: The floating orange button in the Chat screen always leads back to this AI Assistant for help.

User Roles:
- Farmer: Sells produce, manages listings, tracks payouts.
- Buyer: Purchases crops, manages orders, makes offers.
- Admin: Oversees the platform, resolves disputes, verifies users.

Guidelines for your responses:
- Be polite, professional, and helpful.
- Explain technical features in simple terms (especially for farmers).
- If asked about payments, explain the safety of the Escrow system.
- If asked about delivery, mention our integrated transport services.
- If a user reports a technical bug, advise them to contact a human admin or provide details for us to investigate.
- Keep answers concise but informative.
`;

/**
 * Generate a response from the Support AI
 * @param {string} userMessage - The message from the user
 * @param {Array} history - Previous messages for context (optional)
 */
exports.getSupportResponse = async (userMessage, history = []) => {
  try {
    const BOT_ID = '000000000000000000000000';

    if (!process.env.GEMINI_API_KEY) {
      return "Hello! I am the KrushiMitra AI. It seems my API key is not configured, but I can tell you that KrushiMitra is a platform connecting farmers and buyers directly with secure escrow payments and AI price predictions.";
    }

    // Format history for Gemini
    const contents = [
      { role: 'user', parts: [{ text: PROJECT_CONTEXT }] },
      { role: 'model', parts: [{ text: "Understood. I am ready to assist KrushiMitra users with any questions about the platform's functionality and features." }] }
    ];

    // Add recent history (last 5 messages)
    history.forEach(h => {
      contents.push({
        role: String(h.sender) === BOT_ID ? 'model' : 'user',
        parts: [{ text: h.content }]
      });
    });

    // Add current message
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: contents,
    });

    return response.text || "I am here to help with KrushiMitra. What would you like to know?";
  } catch (error) {
    logger.error('❌ AI Support Error:', error);
    return "I'm sorry, I'm having trouble processing your request right now. Please try again later or contact a human administrator.";
  }
};
