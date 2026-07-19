/**
 * Cryptographically strong session token for a checkout fraud flow.
 * Safe to generate on the server (Next.js route handlers / Server Actions).
 */
export function createFraudSessionToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Best-effort client IP from common reverse-proxy headers. */
export function resolveClientIp(headers: Headers | Record<string, string | string[] | undefined>): string | undefined {
  const get = (name: string): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get(name) ?? undefined;
    }
    const raw = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(raw)) return raw[0];
    return raw;
  };

  const forwarded = get("x-forwarded-for") || get("X-Forwarded-For");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 45);
  }

  const realIp = get("x-real-ip") || get("X-Real-Ip") || get("cf-connecting-ip");
  if (realIp) return realIp.trim().slice(0, 45);

  return undefined;
}
