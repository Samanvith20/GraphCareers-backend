
export const applyRateLimit = (limiter, keyFn) => {
  return async (req, res, next) => {
    try {
      const key = keyFn(req);
      await limiter.consume(key);
      next();
    } catch {
      res.status(429).json({
        message: "Too many attempts. Please try again later.",
      });
    }
  };
};