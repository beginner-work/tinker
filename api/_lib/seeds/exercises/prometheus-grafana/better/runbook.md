# Incident runbook: checkout SLO burn

## Symptom

Prometheus alert `CheckoutErrorBudgetBurnFast` is firing, or Grafana success ratio drops below the 99% SLO.

## First checks

1. Open Grafana "Checkout SLO" and confirm `job:http_success:ratio_rate5m`.
2. Compare `app_series_count` to the baseline high-cardinality run (should stay bounded).
3. Check recent deploys / fail injections (`FAIL_RATE`, mock incident script).

## Mitigate

- Lower fail rate / disable the bad path.
- Confirm burn-rate alert clears after the fast window recovers.
- Keep labels on route templates only; never put raw user ids on metrics.
