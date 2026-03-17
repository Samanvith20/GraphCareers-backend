import * as Sentry from "@sentry/node";

const SENTRY_DSN=process.env.SENTRY_DSN;
const BACKEND_NODE_ENV=process.env.BACKEND_NODE_ENV;
const isProductionLike =
  Boolean(SENTRY_DSN) &&
  ['prod', 'production'].includes(BACKEND_NODE_ENV);

if (isProductionLike) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: BACKEND_NODE_ENV,

    // Keep sampling explicit
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
  });
}

export default Sentry;  