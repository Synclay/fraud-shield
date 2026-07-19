import { SynclayFraudShieldError } from "./errors.js";
import type {
  FraudCaptchaVerifyInput,
  FraudCaptchaVerifyResult,
  FraudCheckInput,
  FraudCheckResult,
  FraudConfig,
  FraudInitialInput,
  FraudOtpSendInput,
  FraudOtpSendResult,
  FraudOtpVerifyInput,
  FraudOtpVerifyResult,
  SynclayFraudShieldOptions,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.synclay.com";
const DEFAULT_TIMEOUT_MS = 15_000;

type Envelope<T> = {
  ok?: boolean;
  success?: boolean;
  data?: T;
  settings?: FraudConfig["settings"];
  geoIpAvailable?: boolean;
  turnstileSiteKey?: string | null;
  turnstileConfigured?: boolean;
  entries?: unknown[];
  message?: string;
  code?: string;
  error?: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function connectBase(baseUrl: string): string {
  const root = normalizeBaseUrl(baseUrl);
  if (root.endsWith("/v1/connect")) return root;
  if (root.endsWith("/v1")) return `${root}/connect`;
  return `${root}/v1/connect`;
}

/**
 * Server-side Synclay Fraud Shield client.
 *
 * Keep `apiKey` on the server only — never ship it to the browser.
 */
export class SynclayFraudShield {
  readonly shopId: string;
  private readonly apiKey: string;
  private readonly connectUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SynclayFraudShieldOptions) {
    if (!options.apiKey?.trim()) {
      throw new SynclayFraudShieldError(
        "SYNCLAY_API_KEY (PAT) is required.",
        { code: "missing_api_key", status: 500 }
      );
    }
    if (!options.shopId?.trim()) {
      throw new SynclayFraudShieldError("SYNCLAY_SHOP_ID is required.", {
        code: "missing_shop_id",
        status: 500,
      });
    }

    this.apiKey = options.apiKey.trim();
    this.shopId = options.shopId.trim();
    this.connectUrl = connectBase(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Public fraud settings + Turnstile site key for your checkout UI. */
  async getConfig(): Promise<FraudConfig> {
    const url = new URL(`${this.connectUrl}/fraud/config`);
    url.searchParams.set("shopId", this.shopId);
    const json = await this.request<Envelope<never>>(url.toString(), {
      method: "GET",
    });
    return {
      ok: json.ok !== false,
      settings: json.settings ?? {},
      geoIpAvailable: Boolean(json.geoIpAvailable),
      turnstileSiteKey: json.turnstileSiteKey ?? null,
      turnstileConfigured: Boolean(json.turnstileConfigured),
    };
  }

  /** Early IP / blocklist / velocity check (before phone courier lookup). */
  async initial(input: FraudInitialInput = {}): Promise<FraudCheckResult> {
    const json = await this.request<Envelope<FraudCheckResult>>(
      `${this.connectUrl}/fraud/initial`,
      {
        method: "POST",
        body: JSON.stringify({
          shopId: this.shopId,
          ...input,
        }),
      }
    );
    return this.unwrapCheck(json);
  }

  /** Full checkout evaluation (courier success, behavior, ML signals). */
  async check(input: FraudCheckInput): Promise<FraudCheckResult> {
    const json = await this.request<Envelope<FraudCheckResult>>(
      `${this.connectUrl}/fraud/check`,
      {
        method: "POST",
        body: JSON.stringify({
          shopId: this.shopId,
          ...input,
          email: input.email === "" ? undefined : input.email,
        }),
      }
    );
    return this.unwrapCheck(json);
  }

  async sendOtp(input: FraudOtpSendInput): Promise<FraudOtpSendResult> {
    const json = await this.request<Envelope<FraudOtpSendResult>>(
      `${this.connectUrl}/fraud/otp/send`,
      {
        method: "POST",
        body: JSON.stringify({
          shopId: this.shopId,
          sessionToken: input.sessionToken,
          phone: input.phone,
        }),
      }
    );
    return (json.data ?? {}) as FraudOtpSendResult;
  }

  async verifyOtp(input: FraudOtpVerifyInput): Promise<FraudOtpVerifyResult> {
    const json = await this.request<Envelope<FraudOtpVerifyResult>>(
      `${this.connectUrl}/fraud/otp/verify`,
      {
        method: "POST",
        body: JSON.stringify({
          shopId: this.shopId,
          sessionToken: input.sessionToken,
          phone: input.phone,
          code: input.code,
        }),
      }
    );
    if (!json.data) {
      throw new SynclayFraudShieldError("OTP verify returned empty data.", {
        code: "empty_response",
        status: 502,
      });
    }
    return json.data;
  }

  async verifyCaptcha(
    input: FraudCaptchaVerifyInput
  ): Promise<FraudCaptchaVerifyResult> {
    const json = await this.request<Envelope<FraudCaptchaVerifyResult>>(
      `${this.connectUrl}/fraud/captcha/verify`,
      {
        method: "POST",
        body: JSON.stringify({
          shopId: this.shopId,
          sessionToken: input.sessionToken,
          captchaToken: input.captchaToken,
        }),
      }
    );
    return json.data ?? { verified: false };
  }

  /** Active blocklist snapshot (for optional local caching). */
  async getBlocklist(): Promise<unknown[]> {
    const url = new URL(`${this.connectUrl}/fraud/blocklist`);
    url.searchParams.set("shopId", this.shopId);
    const json = await this.request<Envelope<never> & { entries?: unknown[] }>(
      url.toString(),
      { method: "GET" }
    );
    return json.entries ?? [];
  }

  private unwrapCheck(json: Envelope<FraudCheckResult>): FraudCheckResult {
    if (!json.data) {
      throw new SynclayFraudShieldError("Fraud check returned empty data.", {
        code: "empty_response",
        status: 502,
        details: json,
      });
    }
    return {
      decision: json.data.decision,
      finalScore: json.data.finalScore ?? 0,
      triggeredSignals: json.data.triggeredSignals ?? [],
      blocked: Boolean(json.data.blocked),
      captchaRequired: Boolean(json.data.captchaRequired),
      otpRequired: Boolean(json.data.otpRequired),
      otpToken: json.data.otpToken,
      otpExpiresIn: json.data.otpExpiresIn,
    };
  }

  private async request<T>(
    url: string,
    init: RequestInit
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });

      const text = await res.text();
      let json: Envelope<unknown> = {};
      if (text) {
        try {
          json = JSON.parse(text) as Envelope<unknown>;
        } catch {
          throw new SynclayFraudShieldError(
            "Synclay API returned non-JSON response.",
            { code: "invalid_json", status: res.status, details: text.slice(0, 200) }
          );
        }
      }

      if (!res.ok) {
        throw new SynclayFraudShieldError(
          json.message || json.error || `Synclay API error (${res.status}).`,
          {
            code: json.code || "api_error",
            status: res.status,
            details: json,
          }
        );
      }

      return json as T;
    } catch (error) {
      if (error instanceof SynclayFraudShieldError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SynclayFraudShieldError("Synclay Fraud Shield request timed out.", {
          code: "timeout",
          status: 504,
        });
      }
      throw new SynclayFraudShieldError(
        error instanceof Error ? error.message : "Network request failed.",
        { code: "network_error", status: 502, details: error }
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Convenience factory — same as `new SynclayFraudShield(options)`. */
export function createFraudShield(
  options: SynclayFraudShieldOptions
): SynclayFraudShield {
  return new SynclayFraudShield(options);
}

/**
 * Build a client from env-style key/value map.
 * Pass `process.env` from your app — this SDK never reads env globals itself.
 *
 * Expected keys:
 * - `SYNCLAY_API_KEY` / `SYNCLAY_FRAUD_API_KEY`
 * - `SYNCLAY_SHOP_ID`
 * - `SYNCLAY_API_BASE_URL` (optional)
 */
export function createFraudShieldFromEnv(
  env: Record<string, string | undefined>
): SynclayFraudShield {
  return new SynclayFraudShield({
    apiKey: env.SYNCLAY_FRAUD_API_KEY || env.SYNCLAY_API_KEY || "",
    shopId: env.SYNCLAY_SHOP_ID || "",
    baseUrl: env.SYNCLAY_API_BASE_URL || undefined,
  });
}
