import { SynclayFraudShield } from "../client.js";
import { SynclayFraudShieldError, isSynclayFraudShieldError } from "../errors.js";
import { createFraudSessionToken, resolveClientIp } from "../session.js";
import type {
  ClientCaptchaVerifyPayload,
  ClientCheckPayload,
  ClientInitialPayload,
  ClientOtpSendPayload,
  ClientOtpVerifyPayload,
  FraudCheckResult,
  FraudSettings,
  ProxyCheckResponse,
  ProxyInitialResponse,
  SynclayFraudShieldOptions,
} from "../types.js";

export type FraudShieldHandlerOptions = SynclayFraudShieldOptions & {
  /**
   * When Synclay is unreachable and shop uses fail-closed, block checkout.
   * Default: read from remote settings on each initial call; override with boolean.
   */
  failClosed?: boolean;
  /** Default block copy returned to the client. */
  blockMessage?: string;
  /** Message when the cloud engine is unavailable under fail-closed. */
  serviceUnavailableMessage?: string;
};

type JsonBody = Record<string, unknown>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(error: unknown, fallbackStatus = 500): Response {
  if (isSynclayFraudShieldError(error)) {
    return json(
      {
        ok: false,
        error: { code: error.code, message: error.message },
      },
      error.status >= 400 && error.status < 600 ? error.status : fallbackStatus
    );
  }
  const message =
    error instanceof Error ? error.message : "Unexpected Fraud Shield error.";
  return json(
    { ok: false, error: { code: "internal_error", message } },
    fallbackStatus
  );
}

async function readJson(req: Request): Promise<JsonBody> {
  try {
    const body = (await req.json()) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as JsonBody;
    }
    return {};
  } catch {
    return {};
  }
}

function str(value: unknown, max = 512): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

/**
 * Creates Next.js App Router handlers that proxy Fraud Shield to Synclay.
 *
 * ```ts
 * // app/api/fraud-shield/[action]/route.ts
 * import { createFraudShieldHandlers } from "synclay-fraud-shield/next";
 *
 * const handlers = createFraudShieldHandlers({
 *   apiKey: env.SYNCLAY_API_KEY!,
 *   shopId: env.SYNCLAY_SHOP_ID!,
 * });
 *
 * export const GET = handlers.GET;
 * export const POST = handlers.POST;
 * ```
 *
 * Actions (via `[action]` segment or `?action=`):
 * - `config` (GET)
 * - `initial` | `check` | `otp-send` | `otp-verify` | `captcha-verify` (POST)
 */
export function createFraudShieldHandlers(options: FraudShieldHandlerOptions) {
  const client = new SynclayFraudShield(options);
  const blockMessage =
    options.blockMessage ||
    "We are unable to process your order at this time.";
  const serviceUnavailableMessage =
    options.serviceUnavailableMessage ||
    "Security verification is temporarily unavailable. Please try again shortly.";

  async function handleConfig(): Promise<Response> {
    try {
      const config = await client.getConfig();
      return json({ ok: true, data: config });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function handleInitial(req: Request): Promise<Response> {
    try {
      const body = (await readJson(req)) as ClientInitialPayload;
      const sessionToken = createFraudSessionToken();
      const ip = resolveClientIp(req.headers);

      let settings: FraudSettings = {};
      let turnstileSiteKey: string | null = null;
      try {
        const config = await client.getConfig();
        settings = config.settings ?? {};
        turnstileSiteKey = config.turnstileSiteKey;
      } catch {
        /* config is best-effort for UI */
      }

      const failClosed =
        typeof options.failClosed === "boolean"
          ? options.failClosed
          : Boolean(settings.failClosed);

      let result: FraudCheckResult;
      try {
        result = await client.initial({
          ip,
          deviceHash: str(body.deviceHash, 128),
          visitorId: str(body.visitorId, 64),
          sessionToken,
        });
      } catch (error) {
        if (failClosed) {
          const data: ProxyInitialResponse = {
            sessionToken,
            decision: "BLOCK",
            finalScore: 100,
            blocked: true,
            turnstileSiteKey,
            settings,
          };
          return json({
            ok: true,
            data: {
              ...data,
              message: serviceUnavailableMessage,
            },
          });
        }
        throw error;
      }

      const data: ProxyInitialResponse = {
        sessionToken,
        decision: result.decision,
        finalScore: result.finalScore,
        blocked: result.blocked || result.decision === "BLOCK",
        turnstileSiteKey,
        settings,
      };

      return json({
        ok: true,
        data: {
          ...data,
          message: data.blocked ? blockMessage : undefined,
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function handleCheck(req: Request): Promise<Response> {
    try {
      const body = (await readJson(req)) as ClientCheckPayload;
      const sessionToken = str(body.sessionToken, 128);
      if (!sessionToken) {
        throw new SynclayFraudShieldError("sessionToken is required.", {
          code: "invalid_request",
          status: 422,
        });
      }

      // Honeypot — bots that fill hidden fields are blocked locally.
      if (str(body.websiteUrl, 256)) {
        const blocked: ProxyCheckResponse = {
          sessionToken,
          decision: "BLOCK",
          finalScore: 100,
          triggeredSignals: ["honeypot"],
          blocked: true,
          captchaRequired: false,
          otpRequired: false,
        };
        return json({
          ok: true,
          data: { ...blocked, message: blockMessage },
        });
      }

      const ip = resolveClientIp(req.headers);
      const result = await client.check({
        ip,
        sessionToken,
        phone: str(body.phone, 32),
        email: str(body.email, 256),
        name: str(body.name, 256),
        address: str(body.address, 2000),
        orderTotal: num(body.orderTotal),
        deviceHash: str(body.deviceHash, 128),
        visitorId: str(body.visitorId, 64),
        timeOnPage: num(body.timeOnPage),
        timeOnSite: num(body.timeOnSite),
        pageViews: num(body.pageViews)
          ? Math.floor(num(body.pageViews)!)
          : undefined,
        directCheckout: bool(body.directCheckout),
        typingEvents: body.typingEvents,
        pasteAttempts: body.pasteAttempts,
      });

      const data: ProxyCheckResponse = {
        ...result,
        sessionToken,
        blocked: result.blocked || result.decision === "BLOCK",
      };

      return json({
        ok: true,
        data: {
          ...data,
          message: data.blocked ? blockMessage : undefined,
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function handleOtpSend(req: Request): Promise<Response> {
    try {
      const body = (await readJson(req)) as ClientOtpSendPayload;
      const sessionToken = str(body.sessionToken, 128);
      const phone = str(body.phone, 32);
      if (!sessionToken || !phone) {
        throw new SynclayFraudShieldError(
          "sessionToken and phone are required.",
          { code: "invalid_request", status: 422 }
        );
      }
      const data = await client.sendOtp({ sessionToken, phone });
      return json({ ok: true, data });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function handleOtpVerify(req: Request): Promise<Response> {
    try {
      const body = (await readJson(req)) as ClientOtpVerifyPayload;
      const sessionToken = str(body.sessionToken, 128);
      const phone = str(body.phone, 32);
      const code = str(body.code, 8);
      if (!sessionToken || !phone || !code) {
        throw new SynclayFraudShieldError(
          "sessionToken, phone, and code are required.",
          { code: "invalid_request", status: 422 }
        );
      }
      const data = await client.verifyOtp({ sessionToken, phone, code });
      return json({ ok: true, data });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function handleCaptchaVerify(req: Request): Promise<Response> {
    try {
      const body = (await readJson(req)) as ClientCaptchaVerifyPayload;
      const sessionToken = str(body.sessionToken, 128);
      const captchaToken = str(body.captchaToken, 4096);
      if (!sessionToken || !captchaToken) {
        throw new SynclayFraudShieldError(
          "sessionToken and captchaToken are required.",
          { code: "invalid_request", status: 422 }
        );
      }
      const data = await client.verifyCaptcha({ sessionToken, captchaToken });
      return json({ ok: true, data });
    } catch (error) {
      return errorResponse(error);
    }
  }

  function actionFrom(req: Request, params?: { action?: string }): string {
    if (params?.action) return params.action;
    const url = new URL(req.url);
    const q = url.searchParams.get("action");
    if (q) return q;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  }

  async function GET(
    req: Request,
    ctx?: { params?: Promise<{ action?: string }> | { action?: string } }
  ): Promise<Response> {
    const params = ctx?.params
      ? await Promise.resolve(ctx.params)
      : undefined;
    const action = actionFrom(req, params);
    if (action === "config" || action === "fraud-shield") {
      return handleConfig();
    }
    return json(
      {
        ok: false,
        error: {
          code: "not_found",
          message: `Unknown action "${action}". Use GET config.`,
        },
      },
      404
    );
  }

  async function POST(
    req: Request,
    ctx?: { params?: Promise<{ action?: string }> | { action?: string } }
  ): Promise<Response> {
    const params = ctx?.params
      ? await Promise.resolve(ctx.params)
      : undefined;
    const action = actionFrom(req, params);

    switch (action) {
      case "initial":
        return handleInitial(req);
      case "check":
        return handleCheck(req);
      case "otp-send":
      case "otp/send":
        return handleOtpSend(req);
      case "otp-verify":
      case "otp/verify":
        return handleOtpVerify(req);
      case "captcha-verify":
      case "captcha/verify":
        return handleCaptchaVerify(req);
      default:
        return json(
          {
            ok: false,
            error: {
              code: "not_found",
              message: `Unknown action "${action}".`,
            },
          },
          404
        );
    }
  }

  return { GET, POST, client };
}
