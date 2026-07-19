"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BehaviorTracker,
  getOrCreateDeviceHash,
  getSessionMetrics,
  initSessionMetrics,
} from "../behavior.js";
import type {
  FraudCheckResult,
  FraudDecision,
  FraudProxyConfig,
  FraudSettings,
  ProxyCheckResponse,
  ProxyInitialResponse,
} from "../types.js";

export type FraudShieldStatus =
  | "idle"
  | "booting"
  | "ready"
  | "checking"
  | "challenge"
  | "allowed"
  | "blocked"
  | "error";

export type FraudChallengeKind = "otp" | "captcha" | null;

export type FraudShieldCheckoutFields = {
  phone?: string;
  email?: string;
  name?: string;
  address?: string;
  orderTotal?: number;
};

export type FraudShieldContextValue = {
  status: FraudShieldStatus;
  sessionToken: string | null;
  decision: FraudDecision | null;
  score: number;
  blocked: boolean;
  challenge: FraudChallengeKind;
  captchaRequired: boolean;
  otpRequired: boolean;
  turnstileSiteKey: string | null;
  settings: FraudSettings;
  message: string | null;
  error: string | null;
  /** Run early IP/device check (call on checkout mount). */
  boot: () => Promise<ProxyInitialResponse | null>;
  /** Full fraud evaluation before placing the order. */
  evaluate: (
    fields: FraudShieldCheckoutFields
  ) => Promise<ProxyCheckResponse | null>;
  sendOtp: (phone: string) => Promise<boolean>;
  verifyOtp: (phone: string, code: string) => Promise<boolean>;
  verifyCaptcha: (captchaToken: string) => Promise<boolean>;
  reset: () => void;
  apiPath: string;
};

const FraudShieldContext = createContext<FraudShieldContextValue | null>(null);

type ApiOk<T> = { ok: true; data: T & { message?: string } };
type ApiErr = { ok: false; error: { code: string; message: string } };

async function postJson<T>(
  apiPath: string,
  action: string,
  body: unknown
): Promise<T> {
  const res = await fetch(`${apiPath.replace(/\/$/, "")}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as ApiOk<T> | ApiErr;
  if (!json.ok) {
    throw new Error(json.error?.message || "Fraud Shield request failed.");
  }
  return json.data;
}

export type FraudShieldProviderProps = {
  children: ReactNode;
  config?: FraudProxyConfig;
  /** Auto-run initial check on mount (default true). */
  autoBoot?: boolean;
};

export function FraudShieldProvider({
  children,
  config,
  autoBoot = true,
}: FraudShieldProviderProps) {
  const apiPath = config?.apiPath ?? "/api/fraud-shield";
  const messages = config?.messages;

  const [status, setStatus] = useState<FraudShieldStatus>("idle");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [decision, setDecision] = useState<FraudDecision | null>(null);
  const [score, setScore] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [challenge, setChallenge] = useState<FraudChallengeKind>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [otpRequired, setOtpRequired] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<FraudSettings>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trackerRef = useRef<BehaviorTracker | null>(null);
  const bootedRef = useRef(false);

  useEffect(() => {
    initSessionMetrics();
    trackerRef.current = new BehaviorTracker();
    const detach = trackerRef.current.attach(document);
    return detach;
  }, []);

  const applyCheck = useCallback(
    (
      data: Partial<FraudCheckResult> & {
        decision: FraudDecision;
        message?: string;
        sessionToken?: string;
        blocked?: boolean;
        finalScore?: number;
      }
    ) => {
      setDecision(data.decision);
      setScore(data.finalScore ?? 0);
      setBlocked(Boolean(data.blocked) || data.decision === "BLOCK");
      setCaptchaRequired(Boolean(data.captchaRequired));
      setOtpRequired(Boolean(data.otpRequired));

      if (data.blocked || data.decision === "BLOCK") {
        setStatus("blocked");
        setChallenge(null);
        setMessage(
          data.message ||
            messages?.blocked ||
            "We are unable to process your order at this time."
        );
        return;
      }

      if (data.decision === "OTP_REQUIRED" || data.otpRequired) {
        setStatus("challenge");
        setChallenge("otp");
        setMessage(messages?.otpHint ?? null);
        return;
      }

      if (data.captchaRequired) {
        setStatus("challenge");
        setChallenge("captcha");
        setMessage(messages?.captchaTitle ?? null);
        return;
      }

      setStatus("allowed");
      setChallenge(null);
      setMessage(null);
    },
    [messages]
  );

  const boot = useCallback(async () => {
    setStatus("booting");
    setError(null);
    try {
      const data = await postJson<ProxyInitialResponse & { message?: string }>(
        apiPath,
        "initial",
        {
          deviceHash: getOrCreateDeviceHash(),
          visitorId: undefined,
        }
      );
      setSessionToken(data.sessionToken);
      setTurnstileSiteKey(data.turnstileSiteKey ?? null);
      setSettings(data.settings ?? {});
      applyCheck(data);
      if (!data.blocked && data.decision !== "BLOCK") {
        setStatus("ready");
      }
      bootedRef.current = true;
      return data;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to start Fraud Shield.";
      setError(msg);
      setStatus("error");
      setMessage(messages?.serviceUnavailable ?? msg);
      return null;
    }
  }, [apiPath, applyCheck, messages]);

  const evaluate = useCallback(
    async (fields: FraudShieldCheckoutFields) => {
      let token = sessionToken;
      if (!token) {
        const initial = await boot();
        if (!initial || initial.blocked) return null;
        token = initial.sessionToken;
      }
      if (!token) {
        setError("Missing fraud session.");
        setStatus("error");
        return null;
      }

      setStatus("checking");
      setError(null);

      const metrics = getSessionMetrics();
      const behavior = trackerRef.current?.snapshot();

      try {
        const data = await postJson<ProxyCheckResponse & { message?: string }>(
          apiPath,
          "check",
          {
            sessionToken: token,
            phone: fields.phone,
            email: fields.email,
            name: fields.name,
            address: fields.address,
            orderTotal: fields.orderTotal,
            deviceHash: getOrCreateDeviceHash(),
            timeOnPage: behavior?.timeOnPage,
            timeOnSite: metrics.timeOnSite,
            pageViews: metrics.pageViews,
            directCheckout: metrics.directCheckout,
            typingEvents: behavior?.typingEvents,
            pasteAttempts: behavior?.pasteAttempts,
          }
        );
        applyCheck(data);
        return data;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Fraud check failed.";
        setError(msg);
        setStatus("error");
        setMessage(messages?.serviceUnavailable ?? msg);
        return null;
      }
    },
    [apiPath, applyCheck, boot, messages, sessionToken]
  );

  const sendOtp = useCallback(
    async (phone: string) => {
      if (!sessionToken) return false;
      try {
        await postJson(apiPath, "otp-send", { sessionToken, phone });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "OTP send failed.");
        return false;
      }
    },
    [apiPath, sessionToken]
  );

  const verifyOtp = useCallback(
    async (phone: string, code: string) => {
      if (!sessionToken) return false;
      try {
        const data = await postJson<{ decision: string; reason?: string }>(
          apiPath,
          "otp-verify",
          { sessionToken, phone, code }
        );
        if (data.decision === "ALLOW") {
          setStatus("allowed");
          setChallenge(null);
          setBlocked(false);
          setDecision("ALLOW");
          setMessage(null);
          return true;
        }
        if (data.decision === "BLOCK") {
          setStatus("blocked");
          setBlocked(true);
          setMessage(messages?.blocked ?? "Verification failed.");
          return false;
        }
        setError(data.reason || "Invalid code. Please try again.");
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "OTP verify failed.");
        return false;
      }
    },
    [apiPath, messages, sessionToken]
  );

  const verifyCaptcha = useCallback(
    async (captchaToken: string) => {
      if (!sessionToken) return false;
      try {
        const data = await postJson<{ verified: boolean }>(
          apiPath,
          "captcha-verify",
          { sessionToken, captchaToken }
        );
        if (data.verified) {
          setStatus("allowed");
          setChallenge(null);
          setBlocked(false);
          setDecision("ALLOW");
          setMessage(null);
          return true;
        }
        setError("Captcha verification failed.");
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Captcha failed.");
        return false;
      }
    },
    [apiPath, sessionToken]
  );

  const reset = useCallback(() => {
    bootedRef.current = false;
    setStatus("idle");
    setSessionToken(null);
    setDecision(null);
    setScore(0);
    setBlocked(false);
    setChallenge(null);
    setCaptchaRequired(false);
    setOtpRequired(false);
    setMessage(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (autoBoot && !bootedRef.current) {
      void boot();
    }
  }, [autoBoot, boot]);

  const value = useMemo<FraudShieldContextValue>(
    () => ({
      status,
      sessionToken,
      decision,
      score,
      blocked,
      challenge,
      captchaRequired,
      otpRequired,
      turnstileSiteKey,
      settings,
      message,
      error,
      boot,
      evaluate,
      sendOtp,
      verifyOtp,
      verifyCaptcha,
      reset,
      apiPath,
    }),
    [
      status,
      sessionToken,
      decision,
      score,
      blocked,
      challenge,
      captchaRequired,
      otpRequired,
      turnstileSiteKey,
      settings,
      message,
      error,
      boot,
      evaluate,
      sendOtp,
      verifyOtp,
      verifyCaptcha,
      reset,
      apiPath,
    ]
  );

  return (
    <FraudShieldContext.Provider value={value}>
      {children}
    </FraudShieldContext.Provider>
  );
}

export function useFraudShield(): FraudShieldContextValue {
  const ctx = useContext(FraudShieldContext);
  if (!ctx) {
    throw new Error(
      "useFraudShield must be used within <FraudShieldProvider>."
    );
  }
  return ctx;
}
