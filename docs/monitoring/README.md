# Monitoring

MultiWA exposes Prometheus metrics for scraping and includes a starter Grafana
dashboard.

## Endpoints

| Process | Metrics endpoint | Notes |
|---|---|---|
| API | `http://<api>:3333/metrics` | Default Node/process metrics + HTTP RED series |
| Worker | `http://<worker>:3002/metrics` | Default metrics + `multiwa_bullmq_jobs` queue gauge |

Both are public like `/health` — **restrict `/metrics` at your proxy/firewall.**

## HTTP RED metrics (API)

Recorded by a global interceptor for every matched route, labelled by the
**route pattern** (e.g. `/api/v1/messages/:id`) so cardinality stays bounded.
The `/metrics` and `/health` endpoints are excluded.

| Metric | Type | Labels |
|---|---|---|
| `http_requests_total` | counter | `method`, `route`, `status` |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` |

Useful queries:

```promql
# Request rate by route
sum by (route) (rate(http_requests_total[5m]))

# 5xx error rate
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# p95 latency by route
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
```

## Setup

1. Point Prometheus at the endpoints — see [`prometheus.yml`](./prometheus.yml)
   (adjust the targets to your network/host:port).
2. Import [`grafana-dashboard.json`](./grafana-dashboard.json) into Grafana
   (Dashboards → New → Import) and select your Prometheus data source.

## Roadmap

Domain counters (messages sent/failed, send-gate 429 by lane, webhook
delivery/failure, connected-profile gauge) and OpenTelemetry tracing are
tracked as follow-ups — see the world-class roadmap.
