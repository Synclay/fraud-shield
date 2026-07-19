# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |

## Reporting a vulnerability

Please report security issues privately:

- Email: **security@synclay.com**
- Or open a [private security advisory](https://github.com/Synclay/fraud-shield/security/advisories/new) on GitHub

Do **not** open a public issue for vulnerabilities that could expose merchant API keys or bypass fraud checks.

We aim to acknowledge reports within **2 business days**.

## Secure integration notes

- Keep `SYNCLAY_API_KEY` on the server only (Next.js route handlers / server actions).
- Never call Synclay Connect with your PAT from the browser.
- Load Cloudflare Turnstile from your own layout/script tag — this package does not inject remote scripts.
