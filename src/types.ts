/** Fraud engine decision returned by Synclay Connect. */
export type FraudDecision = "ALLOW" | "BLOCK" | "OTP_REQUIRED";

export type FraudOtpDecision = "ALLOW" | "BLOCK" | "INVALID";

export type FraudTypingEvent = {
  t: number;
  p: number;
};

export type FraudTypingField = {
  focusTime: number;
  typingEvents: FraudTypingEvent[];
  autofilled?: boolean;
};

export type FraudPasteAttempt = {
  field: string;
  t: number;
};

export type FraudCheckResult = {
  decision: FraudDecision;
  finalScore: number;
  triggeredSignals: string[];
  blocked: boolean;
  captchaRequired: boolean;
  otpRequired: boolean;
  otpToken?: string;
  otpExpiresIn?: number;
};

export type FraudOtpSendResult = {
  sent?: boolean;
  expiresIn?: number;
  message?: string;
  [key: string]: unknown;
};

export type FraudOtpVerifyResult = {
  decision: FraudOtpDecision;
  remaining?: number;
  reason?: string;
};

export type FraudCaptchaVerifyResult = {
  verified: boolean;
};

export type FraudSettings = {
  enabled?: boolean;
  minSuccessRate?: number;
  captchaEnabled?: boolean;
  otpEnabled?: boolean;
  failClosed?: boolean;
  behaviorEnabled?: boolean;
  honeypotEnabled?: boolean;
  deviceFingerprintEnabled?: boolean;
  [key: string]: unknown;
};

export type FraudConfig = {
  ok: boolean;
  settings: FraudSettings;
  geoIpAvailable: boolean;
  turnstileSiteKey: string | null;
  turnstileConfigured: boolean;
};

export type FraudInitialInput = {
  ip?: string;
  deviceHash?: string;
  visitorId?: string;
  sessionToken?: string;
};

export type FraudCheckInput = {
  ip?: string;
  phone?: string;
  email?: string;
  sessionToken?: string;
  deviceHash?: string;
  visitorId?: string;
  orderTotal?: number;
  name?: string;
  address?: string;
  timeOnPage?: number;
  timeOnSite?: number;
  pageViews?: number;
  directCheckout?: boolean;
  typingEvents?: Record<string, FraudTypingField>;
  pasteAttempts?: FraudPasteAttempt[];
};

export type FraudOtpSendInput = {
  sessionToken: string;
  phone: string;
};

export type FraudOtpVerifyInput = {
  sessionToken: string;
  phone: string;
  code: string;
};

export type FraudCaptchaVerifyInput = {
  sessionToken: string;
  captchaToken: string;
};

export type SynclayFraudShieldOptions = {
  /** Personal access token (`sc_live_…` or `sc_test_…`) with `connect:fraud:read`. */
  apiKey: string;
  /** Synclay shop / tenant id. */
  shopId: string;
  /**
   * API origin. Defaults to production (`api.synclay.com`).
   * Local example: `localhost:5001` with your preferred scheme.
   */
  baseUrl?: string;
  /** Fetch timeout in ms (default 15_000). */
  timeoutMs?: number;
  /** Optional custom fetch (for tests / edge runtimes). */
  fetch?: typeof fetch;
};

export type FraudProxyConfig = {
  /** Relative path where your Next.js fraud API lives (default `/api/fraud-shield`). */
  apiPath?: string;
  /** Optional messages shown in the challenge UI. */
  messages?: {
    blocked?: string;
    serviceUnavailable?: string;
    otpTitle?: string;
    otpHint?: string;
    captchaTitle?: string;
  };
};

/** Browser → your Next.js BFF payloads (camelCase). */
export type ClientInitialPayload = {
  deviceHash?: string;
  visitorId?: string;
};

export type ClientCheckPayload = {
  sessionToken: string;
  phone?: string;
  email?: string;
  name?: string;
  address?: string;
  orderTotal?: number;
  deviceHash?: string;
  visitorId?: string;
  timeOnPage?: number;
  timeOnSite?: number;
  pageViews?: number;
  directCheckout?: boolean;
  typingEvents?: Record<string, FraudTypingField>;
  pasteAttempts?: FraudPasteAttempt[];
  /** Honeypot trap value — if non-empty, treated as bot. */
  websiteUrl?: string;
};

export type ClientOtpSendPayload = {
  sessionToken: string;
  phone: string;
};

export type ClientOtpVerifyPayload = {
  sessionToken: string;
  phone: string;
  code: string;
};

export type ClientCaptchaVerifyPayload = {
  sessionToken: string;
  captchaToken: string;
};

export type ProxyInitialResponse = {
  sessionToken: string;
  decision: FraudDecision;
  finalScore: number;
  blocked: boolean;
  turnstileSiteKey?: string | null;
  settings?: FraudSettings;
};

export type ProxyCheckResponse = FraudCheckResult & {
  sessionToken: string;
};

export type ProxyOkResponse<T> = {
  ok: true;
  data: T;
};

export type ProxyErrorResponse = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};
