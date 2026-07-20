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

## Domain metrics (API)

Emitted off the internal event bus by a listener (never on the send hot path).

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `multiwa_messages_sent_total` | counter | `type` | messages sent OK, by message type |
| `multiwa_messages_failed_total` | counter | `type` | message sends that failed, by type |
| `multiwa_connected_profiles` | gauge | — | connected WhatsApp profiles (resynced from the DB at startup, then adjusted by connection events — approximate) |

```promql
# Send failure ratio
sum(rate(multiwa_messages_failed_total[5m]))
  / sum(rate(multiwa_messages_sent_total[5m]) + rate(multiwa_messages_failed_total[5m]))
```

## Setup

1. Point Prometheus at the endpoints — see [`prometheus.yml`](./prometheus.yml)
   (adjust the targets to your network/host:port).
2. Import [`grafana-dashboard.json`](./grafana-dashboard.json) into Grafana
   (Dashboards → New → Import) and select your Prometheus data source.
3. `prometheus.yml` already loads [`alert-rules.yml`](./alert-rules.yml) and points
   at an Alertmanager — run Alertmanager with [`alertmanager.yml`](./alertmanager.yml)
   and replace the placeholder receiver with your sink (Slack, PagerDuty, a MultiWA
   webhook, …). Comment out the `alerting:` block if you only want rule evaluation.

## Alerting & SLOs

[`alert-rules.yml`](./alert-rules.yml) ships rules for the failure modes that
actually took MultiWA down and were invisible until a human noticed:

| Alert | Fires when | Severity |
|---|---|---|
| `MultiWAApiDown` / `MultiWAWorkerDown` | scrape target unreachable | critical |
| `WhatsAppAllProfilesDisconnected` | `multiwa_connected_profiles == 0` for 3m | critical |
| `WhatsAppSendingStalled` | a profile is connected but **0 sends for 20m** (the "sending dead" incident) | critical |
| `WhatsAppHighSendFailureRate` | send failure ratio > 20% for 10m | warning |
| `HighHttpErrorRate` | 5xx ratio > 5% for 5m | warning |
| `HighHttpLatencyP95` | p95 latency > 1s for 10m | warning |

Target **SLOs** (tune to your traffic): availability — < 1 % of requests return 5xx;
latency — p95 < 500 ms; WhatsApp — at least one profile connected and outbound sends
non-zero during business hours. The alert thresholds above are set to page on a burn,
not at the SLO boundary itself.

## Roadmap

Remaining observability follow-ups: send-gate 429 by lane and webhook
delivery/failure counters (these live in the engine-runtime / worker, a
different process registry), plus OpenTelemetry tracing and an error sink.
