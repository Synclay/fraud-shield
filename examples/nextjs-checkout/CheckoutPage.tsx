/**
 * Example checkout page — copy patterns into your storefront.
 */
"use client";

import { useState } from "react";
import "synclay-fraud-shield/styles.css";
import {
  FraudShieldProvider,
  FraudChallenge,
  FraudHoneypot,
  useFraudShield,
} from "synclay-fraud-shield/react";

function CheckoutInner() {
  const { evaluate, status, blocked, sessionToken } = useFraudShield();
  const [phone, setPhone] = useState("");
  const [pendingOrder, setPendingOrder] = useState(false);

  async function placeOrder() {
    setPendingOrder(true);
    try {
      await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          synclaySessionToken: sessionToken,
        }),
      });
      alert("Order placed");
    } finally {
      setPendingOrder(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;

    const fd = new FormData(e.currentTarget);
    const result = await evaluate({
      phone: String(fd.get("phone") || ""),
      email: String(fd.get("email") || ""),
      name: String(fd.get("name") || ""),
      address: String(fd.get("address") || ""),
      orderTotal: Number(fd.get("total") || 0),
    });

    if (result?.decision === "ALLOW" && !result.blocked) {
      await placeOrder();
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "3rem auto", padding: 16 }}>
      <h1>Checkout</h1>
      <form onSubmit={onSubmit}>
        <label>
          Phone
          <input
            name="phone"
            data-synclay-field="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </label>
        <label>
          Email
          <input name="email" data-synclay-field="email" type="email" />
        </label>
        <label>
          Name
          <input name="name" data-synclay-field="name" />
        </label>
        <label>
          Address
          <textarea name="address" data-synclay-field="address" />
        </label>
        <input type="hidden" name="total" value="1490" />
        <FraudHoneypot />
        <button type="submit" disabled={status === "checking" || blocked || pendingOrder}>
          {status === "checking" ? "Securing…" : "Place order"}
        </button>
      </form>

      <FraudChallenge phone={phone} onResolved={() => void placeOrder()} />
    </main>
  );
}

export default function ExampleCheckoutPage() {
  return (
    <FraudShieldProvider>
      <CheckoutInner />
    </FraudShieldProvider>
  );
}
