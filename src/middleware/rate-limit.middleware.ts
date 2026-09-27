import rateLimit from 'express-rate-limit';

/**
 * Strict rate limiter for Authentication endpoints (Login/Register)
 * Limits to 15 attempts per 15 minutes per IP to block brute-force attacks
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.',
  },
});

/**
 * General rate limiter for API endpoints to prevent scraping and denial-of-service
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1200, // 1200 requests per 15 minutes (~80 requests per minute)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many requests generated from this IP. Please slow down.',
  },
});
