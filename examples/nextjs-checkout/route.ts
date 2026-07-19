/**
 * Copy into your Next.js app:
 *   app/api/fraud-shield/[action]/route.ts
 */
import { createFraudShieldHandlers } from "synclay-fraud-shield/next";

const handlers = createFraudShieldHandlers({
  apiKey: process.env.SYNCLAY_API_KEY!,
  shopId: process.env.SYNCLAY_SHOP_ID!,
  baseUrl: process.env.SYNCLAY_API_BASE_URL,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
