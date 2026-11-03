import type { Instrumentation } from "next";

// Server error reporting without a vendor SDK: every error Next.js captures (Server Components, Route Handlers,
// Server Actions, proxy) is written as one redacted JSON log line and, when SENTRY_DSN is set, sent as an
// envelope to that Sentry-compatible endpoint (lib/monitoring.ts).
export async function register() {
  const { log } = await import("./lib/log");
  const { monitoringConfigured } = await import("./lib/monitoring");
  await log.info("server_start", { runtime: process.env.NEXT_RUNTIME ?? "nodejs", monitoring: monitoringConfigured() });
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log } = await import("./lib/log");
  await log.error(
    "request_failed",
    {
      method: request.method,
      // Path without the query string: survey and unsubscribe links carry personal tokens there.
      path: request.path.split("?")[0],
      route: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
    },
    err,
  );
};
