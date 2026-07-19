"use client";

import type { InputHTMLAttributes } from "react";

const DEFAULT_NAME = "website_url";

export type FraudHoneypotProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "name" | "tabIndex" | "autoComplete"
> & {
  /** Field name expected by the BFF (`websiteUrl` mapping). Default `website_url`. */
  name?: string;
};

/**
 * Invisible trap field for bots. Place inside your checkout form.
 * Do not label it for humans — CSS hides it.
 */
export function FraudHoneypot({
  name = DEFAULT_NAME,
  className,
  ...rest
}: FraudHoneypotProps) {
  return (
    <div className="synclay-fs-hp" aria-hidden="true">
      <label htmlFor={`synclay_hp_${name}`}>Website</label>
      <input
        {...rest}
        id={`synclay_hp_${name}`}
        name={name}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        className={["synclay-fs-hp-input", className].filter(Boolean).join(" ")}
      />
    </div>
  );
}
