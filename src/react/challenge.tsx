"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useFraudShield } from "./provider.js";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        }
      ) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}

export type FraudChallengeProps = {
  /** Phone used for OTP (usually billing phone). */
  phone?: string;
  className?: string;
  /** Called when the shopper completes OTP or captcha successfully. */
  onResolved?: () => void;
};

/**
 * Beautiful OTP + Turnstile challenge overlay for checkout.
 * Renders nothing unless `status === "challenge" | "blocked"`.
 */
export function FraudChallenge({
  phone = "",
  className,
  onResolved,
}: FraudChallengeProps) {
  const {
    status,
    challenge,
    message,
    error,
    turnstileSiteKey,
    sendOtp,
    verifyOtp,
    verifyCaptcha,
  } = useFraudShield();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (status !== "challenge" || challenge !== "otp" || !phone || otpSent) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setBusy(true);
      const ok = await sendOtp(phone);
      if (!cancelled) {
        setOtpSent(ok);
        setBusy(false);
        if (!ok) setLocalError("Could not send verification code.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, challenge, phone, otpSent, sendOtp]);

  useEffect(() => {
    if (
      status !== "challenge" ||
      challenge !== "captcha" ||
      !turnstileSiteKey ||
      !captchaRef.current
    ) {
      return;
    }

    let cancelled = false;

    const mount = () => {
      if (cancelled || !captchaRef.current || !window.turnstile) return;
      if (widgetId.current) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* ignore */
        }
      }
      widgetId.current = window.turnstile.render(captchaRef.current, {
        sitekey: turnstileSiteKey,
        theme: "light",
        callback: (token) => {
          void (async () => {
            setBusy(true);
            const ok = await verifyCaptcha(token);
            setBusy(false);
            if (ok) onResolved?.();
          })();
        },
      });
    };

    if (window.turnstile) {
      mount();
    } else {
      const existing = document.querySelector(
        'script[data-synclay-turnstile="1"]'
      );
      if (!existing) {
        const script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.dataset.synclayTurnstile = "1";
        script.onload = () => mount();
        document.head.appendChild(script);
      } else {
        existing.addEventListener("load", mount);
      }
    }

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* ignore */
        }
        widgetId.current = null;
      }
    };
  }, [status, challenge, turnstileSiteKey, verifyCaptcha, onResolved]);

  if (status !== "challenge" && status !== "blocked") {
    return null;
  }

  async function onSubmitOtp(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setBusy(true);
    const ok = await verifyOtp(phone, code.trim());
    setBusy(false);
    if (ok) onResolved?.();
    else setLocalError("Incorrect code. Please try again.");
  }

  const isBlocked = status === "blocked";
  const heading = isBlocked
    ? "Order could not be placed"
    : challenge === "otp"
      ? "Verify your phone"
      : "Quick security check";

  const subtitle = isBlocked
    ? message || "We cannot process this order right now."
    : challenge === "otp"
      ? message ||
        `Enter the code we sent to ${phone || "your phone"} to continue.`
      : message || "Complete the check below to finish checkout.";

  return (
    <div
      className={["synclay-fs-overlay", className].filter(Boolean).join(" ")}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="synclay-fs-backdrop" />
      <div className="synclay-fs-card">
        <div className="synclay-fs-brand">
          <span className="synclay-fs-mark" aria-hidden />
          <span className="synclay-fs-brand-text">Synclay Fraud Shield</span>
        </div>

        <div
          className={
            isBlocked ? "synclay-fs-icon synclay-fs-icon--block" : "synclay-fs-icon"
          }
          aria-hidden
        >
          {isBlocked ? "!" : challenge === "otp" ? "✦" : "◎"}
        </div>

        <h2 id={titleId} className="synclay-fs-title">
          {heading}
        </h2>
        <p className="synclay-fs-subtitle">{subtitle}</p>

        {(error || localError) && !isBlocked ? (
          <p className="synclay-fs-error" role="alert">
            {localError || error}
          </p>
        ) : null}

        {!isBlocked && challenge === "otp" ? (
          <form className="synclay-fs-form" onSubmit={onSubmitOtp}>
            <label className="synclay-fs-label" htmlFor="synclay-fs-otp">
              Verification code
            </label>
            <input
              id="synclay-fs-otp"
              className="synclay-fs-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              disabled={busy}
              required
            />
            <button
              type="submit"
              className="synclay-fs-button"
              disabled={busy || code.length < 4}
            >
              {busy ? "Verifying…" : "Confirm & continue"}
            </button>
            <button
              type="button"
              className="synclay-fs-link"
              disabled={busy || !phone}
              onClick={() => {
                setOtpSent(false);
                setLocalError(null);
              }}
            >
              Resend code
            </button>
          </form>
        ) : null}

        {!isBlocked && challenge === "captcha" ? (
          <div className="synclay-fs-captcha-wrap">
            <div ref={captchaRef} className="synclay-fs-captcha" />
            {busy ? (
              <p className="synclay-fs-muted">Verifying…</p>
            ) : null}
          </div>
        ) : null}

        {isBlocked ? (
          <p className="synclay-fs-muted">
            If you believe this is a mistake, contact the store for help.
          </p>
        ) : null}
      </div>
    </div>
  );
}
