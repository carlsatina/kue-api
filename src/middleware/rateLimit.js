import rateLimit from "express-rate-limit";

// Throttles sensitive auth endpoints (credential checks, account creation,
// email-triggering flows) to slow brute-force and abuse. Keyed by client IP;
// requires `app.set("trust proxy", ...)` when behind a reverse proxy so the
// real client IP is used instead of the proxy's.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." }
});
