const { GoogleGenAI } = require('@google/genai');

const aiConfig = {
  apiKey: process.env.GEMINI_API_KEY || 'MISSING_API_KEY',
};

const ai = new GoogleGenAI(aiConfig);

/**
 * Predict optimal crop price based on image (if provided),
 * crop type, and current Mandi prices.
 * POST /api/crops/predict-price
 * Body: { imageUrl: string, cropName: string, currentMandiPrice: number, quality: string }
 */
exports.predictPrice = async (req, res) => {
  try {
    const { cropName, currentMandiPrice, quality, description } = req.body;

    if (!cropName) {
      return res.status(400).json({ success: false, message: 'cropName is required for prediction' });
    }
    
    if (!process.env.GEMINI_API_KEY) {
      // Graceful fallback for demo/development if no key is provided
      const dummySuggestion = currentMandiPrice ? Number(currentMandiPrice) * 1.05 : 1500;
      return res.status(200).json({
        success: true,
        data: {
          suggestedPrice: Math.round(dummySuggestion),
          reasoning: "AI API Key not configured. Using standard baseline plus 5% margin."
        }
      });
    }

    const promptText = `
      You are an expert agricultural AI assistant.
      A farmer wants to sell a crop with the following details:
      - Crop Name: ${cropName}
      - Quality reported: ${quality || 'Standard'}
      - Current standard Mandi (Market) Price: ₹${currentMandiPrice || 'Unknown'} per quintal
      - Description: ${description || 'None'}
      
      Based on this information (and current typical market trends in India if Mandi price is unknown), suggest the BEST competitive price for the farmer to list this crop per quintal on a digital marketplace.
      Please consider a reasonable profit margin if quality is high.
      
      Return ONLY a valid JSON object with exact keys:
      {
        "suggestedPrice": <number>,
        "reasoning": "<short string explaining why this price is suggested>"
      }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: promptText,
    });

    const text = response.text || '';
    // Extract JSON from potential markdown wrapping
    let jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    let parsedData = null;
    
    if (jsonMatch) {
      parsedData = JSON.parse(jsonMatch[1]);
    } else {
      // Try parsing the text directly
      const fallbackClean = text.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(fallbackClean);
    }

    if (!parsedData || !parsedData.suggestedPrice) {
      throw new Error("Failed to parse valid price from AI.");
    }

    res.status(200).json({
      success: true,
      data: parsedData
    });
  } catch (error) {
    console.error('AI Prediction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate AI price prediction',
      error: process.env.NODE_ENV === 'development' ? error.toString() : 'AI Error'
    });
  }
};
