import type { FraudPasteAttempt, FraudTypingField } from "./types.js";

const DEVICE_KEY_PREFIX = "synclay_dev_";
const SITE_KEY = "synclay_time_on_site";
const VIEWS_KEY = "synclay_page_views";
const FIRST_KEY = "synclay_first_path";
const START_KEY = "synclay_session_start";

/** Stable-ish device hash stored in localStorage (browser only). */
export function getOrCreateDeviceHash(): string {
  if (typeof window === "undefined") return "";
  try {
    const key = DEVICE_KEY_PREFIX + (navigator.userAgent || "").slice(0, 40);
    let stored = window.localStorage.getItem(key);
    if (!stored) {
      stored =
        Date.now().toString(16) + Math.random().toString(16).slice(2);
      window.localStorage.setItem(key, stored);
    }
    return stored.slice(0, 64);
  } catch {
    return `fallback-${Date.now()}`;
  }
}

/** Start / refresh session metrics used by the fraud engine. */
export function initSessionMetrics(): void {
  if (typeof window === "undefined") return;
  try {
    if (!sessionStorage.getItem(FIRST_KEY)) {
      sessionStorage.setItem(FIRST_KEY, window.location.pathname || "/");
    }
    if (!sessionStorage.getItem(START_KEY)) {
      sessionStorage.setItem(START_KEY, String(Date.now()));
    }
    const views = parseInt(localStorage.getItem(VIEWS_KEY) || "0", 10) + 1;
    localStorage.setItem(VIEWS_KEY, String(views));

    const start = parseInt(
      sessionStorage.getItem(START_KEY) || String(Date.now()),
      10
    );
    const tick = () => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      localStorage.setItem(SITE_KEY, String(elapsed));
    };
    tick();
    window.setInterval(tick, 5000);
  } catch {
    /* storage blocked */
  }
}

export type SessionMetrics = {
  timeOnSite: number;
  pageViews: number;
  directCheckout: boolean;
};

export function getSessionMetrics(
  checkoutPathHint = "checkout"
): SessionMetrics {
  if (typeof window === "undefined") {
    return { timeOnSite: 0, pageViews: 1, directCheckout: false };
  }
  try {
    const firstPath = sessionStorage.getItem(FIRST_KEY) || "";
    const path = window.location.pathname || "";
    const directCheckout =
      firstPath === path ||
      firstPath.includes(checkoutPathHint) ||
      path.includes(checkoutPathHint);

    return {
      timeOnSite: parseInt(localStorage.getItem(SITE_KEY) || "0", 10),
      pageViews: parseInt(localStorage.getItem(VIEWS_KEY) || "1", 10),
      directCheckout,
    };
  } catch {
    return { timeOnSite: 0, pageViews: 1, directCheckout: false };
  }
}

/**
 * Lightweight typing / paste behavior collector for checkout fields.
 * Attach to inputs with `data-synclay-field="phone"` etc.
 */
export class BehaviorTracker {
  private readonly typing: Record<string, FraudTypingField> = {};
  private readonly pastes: FraudPasteAttempt[] = [];
  private readonly pageStartedAt = Date.now();
  private attached = false;

  get timeOnPage(): number {
    return Math.floor((Date.now() - this.pageStartedAt) / 1000);
  }

  attach(root: ParentNode | Document = document): () => void {
    if (typeof window === "undefined" || this.attached) {
      return () => undefined;
    }
    this.attached = true;

    const onFocus = (e: Event) => {
      const el = e.target as HTMLInputElement | null;
      const field = fieldName(el);
      if (!field || !el) return;
      ensureField(this.typing, field);
      this.typing[field]!.focusTime = Date.now();
    };

    const onInput = (e: Event) => {
      const el = e.target as HTMLInputElement | null;
      const field = fieldName(el);
      if (!field || !el) return;
      const entry = ensureField(this.typing, field);
      const now = Date.now();
      entry.typingEvents.push({
        t: now - (entry.focusTime || now),
        p: el.value.length,
      });
      if (entry.typingEvents.length > 500) {
        entry.typingEvents.splice(0, entry.typingEvents.length - 500);
      }
      if (
        (e as InputEvent).inputType === "insertReplacementText" ||
        el.matches(":-webkit-autofill")
      ) {
        entry.autofilled = true;
      }
    };

    const onPaste = (e: Event) => {
      const el = e.target as HTMLInputElement | null;
      const field = fieldName(el);
      if (!field) return;
      if (this.pastes.length < 50) {
        this.pastes.push({ field, t: Date.now() - this.pageStartedAt });
      }
    };

    root.addEventListener("focusin", onFocus, true);
    root.addEventListener("input", onInput, true);
    root.addEventListener("paste", onPaste, true);

    return () => {
      root.removeEventListener("focusin", onFocus, true);
      root.removeEventListener("input", onInput, true);
      root.removeEventListener("paste", onPaste, true);
      this.attached = false;
    };
  }

  snapshot(): {
    typingEvents: Record<string, FraudTypingField>;
    pasteAttempts: FraudPasteAttempt[];
    timeOnPage: number;
  } {
    return {
      typingEvents: structuredCloneSafe(this.typing),
      pasteAttempts: this.pastes.slice(),
      timeOnPage: this.timeOnPage,
    };
  }
}

function fieldName(el: HTMLInputElement | null): string | null {
  if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return null;
  const named =
    el.getAttribute("data-synclay-field") ||
    el.getAttribute("name") ||
    el.id;
  if (!named) return null;
  return named.slice(0, 64);
}

function ensureField(
  map: Record<string, FraudTypingField>,
  field: string
): FraudTypingField {
  if (!map[field]) {
    map[field] = { focusTime: Date.now(), typingEvents: [] };
  }
  return map[field]!;
}

function structuredCloneSafe<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
