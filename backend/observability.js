const crypto = require("crypto");
const client = require("@prometheus-io/client");

const registry = new client.Registry();

const requests = new client.Counter({
  name: "http_requests_total",
  help: "Completed HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});

const latency = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

function requestLogger(req, res, next) {
  // Exclude monitoring requests from application traffic.
  if (req.path === "/metrics") return next();

  const requestId = crypto.randomUUID();
  const started = process.hrtime.bigint();

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  res.on("finish", () => {
    const seconds =
      Number(process.hrtime.bigint() - started) / 1e9;

    // Route templates avoid logging entity IDs or query parameters.
    const route =
      typeof req.route?.path === "string"
        ? req.route.path
        : "unmatched";

    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };

    requests.inc(labels);
    latency.observe(labels, seconds);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:
        res.statusCode >= 500 ? "error" :
        res.statusCode >= 400 ? "warn" : "info",
      event: "http_request",
      requestId,
      method: req.method,
      path: route,
      statusCode: res.statusCode,
      durationMs: Number((seconds * 1000).toFixed(2)),
    }));
  });

  next();
}

async function metricsHandler(req, res) {
  try {
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  } catch {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "metrics_export_failed",
    }));
    res.status(500).send("Metrics unavailable");
  }
}

module.exports = { requestLogger, metricsHandler };