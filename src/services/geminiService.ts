import { GoogleGenAI, Type } from "@google/genai";
import { RecommendationRequest, RecommendationResponse } from "../types";

// Initialize Gemini AI in the frontend
// The platform automatically provides GEMINI_API_KEY in the environment
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export async function getFashionRecommendations(
  request: RecommendationRequest
): Promise<RecommendationResponse> {
  const prompt = `
    You are an expert fashion stylist specializing in tall proportions.
    A user has provided the following details:
    - Height: ${request.measurements.height}
    - Weight: ${request.measurements.weight || 'N/A'}
    - Inseam: ${request.measurements.inseam}
    - Shoulder Width: ${request.measurements.shoulderWidth || 'N/A'}
    - Style Preference: ${request.stylePreference}
    - Occasion: ${request.occasion}

    Provide 3 specific outfit recommendations that would flatter their tall frame.
    Return JSON with: outfits (array of {title, description, brands[], fitTips[], shopUrl}), generalAdvice (string).
  `;

  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          outfits: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                brands: { type: Type.ARRAY, items: { type: Type.STRING } },
                fitTips: { type: Type.ARRAY, items: { type: Type.STRING } },
                shopUrl: { type: Type.STRING },
              },
              required: ["title", "description", "brands", "fitTips", "shopUrl"],
            },
          },
          generalAdvice: { type: Type.STRING },
        },
        required: ["outfits", "generalAdvice"],
      },
    },
  });

  return JSON.parse(result.text || "{}");
}

export async function estimateMeasurementsFromImage(
  base64Image: string,
  mimeType: string
): Promise<{ height: string; inseam: string; build: string; shoulderWidth: string }> {
  const prompt = "Analyze this image and estimate: height, inseam, build, shoulderWidth. Return JSON.";

  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: mimeType } },
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          height: { type: Type.STRING },
          inseam: { type: Type.STRING },
          build: { type: Type.STRING },
          shoulderWidth: { type: Type.STRING },
        },
        required: ["height", "inseam", "build", "shoulderWidth"],
      },
    },
  });

  return JSON.parse(result.text || "{}");
}

export async function generateVirtualTryOn(
  base64Image: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: mimeType } },
        { text: `Virtual Try-On: Modify the person in the image to be wearing: ${prompt}. Maintain tall proportions.` }
      ]
    },
  });

  const part = result.candidates?.[0]?.content?.parts.find(p => p.inlineData);
  if (part?.inlineData) {
    return `data:image/png;base64,${part.inlineData.data}`;
  }
  throw new Error("No image generated");
}

export async function chatWithStylist(
  message: string,
  history: { role: "user" | "model"; text: string }[] = []
): Promise<string> {
  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    history: history.map(h => ({
      role: h.role,
      parts: [{ text: h.text }]
    })),
    config: {
      systemInstruction: "You are the TallFit Stylist. Expert in fashion for tall people. Sophisticated, encouraging, knowledgeable about brands like American Tall, ASOS Tall, 2Tall. Keep responses concise.",
    }
  });

  const result = await chat.sendMessage({ message });
  return result.text || "";
}
