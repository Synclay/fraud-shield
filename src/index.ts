export type { FraudDecision, FraudOtpDecision, FraudTypingEvent, FraudTypingField, FraudPasteAttempt, FraudCheckResult, FraudOtpSendResult, FraudOtpVerifyResult, FraudCaptchaVerifyResult, FraudSettings, FraudConfig, FraudInitialInput, FraudCheckInput, FraudOtpSendInput, FraudOtpVerifyInput, FraudCaptchaVerifyInput, SynclayFraudShieldOptions, FraudProxyConfig, ClientInitialPayload, ClientCheckPayload, ClientOtpSendPayload, ClientOtpVerifyPayload, ClientCaptchaVerifyPayload, ProxyInitialResponse, ProxyCheckResponse, ProxyOkResponse, ProxyErrorResponse } from "./types.js";

export {
  SynclayFraudShield,
  createFraudShield,
  createFraudShieldFromEnv,
} from "./client.js";

export {
  SynclayFraudShieldError,
  isSynclayFraudShieldError,
} from "./errors.js";

export {
  createFraudSessionToken,
  resolveClientIp,
} from "./session.js";

export {
  getOrCreateDeviceHash,
  initSessionMetrics,
  getSessionMetrics,
  BehaviorTracker,
} from "./behavior.js";
export type { SessionMetrics } from "./behavior.js";
