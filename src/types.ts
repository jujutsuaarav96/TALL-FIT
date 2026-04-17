export interface Measurements {
  height: string;
  weight: string;
  inseam: string;
  shoulderWidth: string;
}

export interface RecommendationRequest {
  measurements: Measurements;
  stylePreference: string;
  occasion: string;
}

export interface RecommendationResponse {
  outfits: {
    title: string;
    description: string;
    brands: string[];
    fitTips: string[];
    shopUrl?: string;
  }[];
  generalAdvice: string;
}
