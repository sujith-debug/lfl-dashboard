/**
 * Next.js loads this file before application code. Keeping SDK registration
 * here allows HTTP, fetch, database, and supported library instrumentation to
 * patch modules before they are imported.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerTracing } = await import("@foundry/logger/tracing");
    registerTracing({
      serviceName: process.env.OTEL_SERVICE_NAME || "foundry-app",
    });
  }
}
