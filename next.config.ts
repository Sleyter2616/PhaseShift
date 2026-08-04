import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {};

const authToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;

export default withSentryConfig(nextConfig, {
  org: sentryOrg,
  project: sentryProject,
  authToken,
  silent: true,
  widenClientFileUpload: true,
  // Same-origin tunnel so ad-blockers/privacy extensions cannot CORS-block
  // browser ingest (client posts to /monitoring; Next rewrites to Sentry).
  tunnelRoute: "/monitoring",
  // Source maps upload only when a build-time auth token is present.
  sourcemaps: {
    disable: !authToken,
  },
});
