/**
 * CI gate for Braintrust project `tinker-ask`.
 * Exit non-zero when TylerAgreement (core) or CasePass floors are missed.
 * Thresholds documented in evals/ask/THRESHOLDS.md.
 */
import { Reporter } from "braintrust";
import * as fs from "node:fs";
import * as path from "node:path";

export const THRESHOLDS = {
  /** Core resume metric: agreement with Tyler's reference essay prose. */
  tylerAgreement: 0.7,
  /** Deterministic keyword / sentence checks where defined. */
  casePass: 0.9,
} as const;

type GateReport = {
  ok: boolean;
  failures: string[];
  tylerAgreementAvg: number | null;
  casePassAvg: number | null;
  latency_ms: { p50: number | null; p95: number | null; n: number };
  experimentUrl: string | null;
  thresholds: typeof THRESHOLDS;
};

function scoreAvg(
  scores: Record<string, { score?: number } | undefined> | undefined,
  name: string,
): number | null {
  const s = scores && scores[name];
  return s && typeof s.score === "number" ? s.score : null;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

Reporter("tinker-ask-gate", {
  reportEval(evaluator, result) {
    const summary = result.summary;
    const latencies: number[] = [];
    for (const row of result.results || []) {
      const out = row.output as { latencyMs?: number } | undefined;
      if (out && typeof out.latencyMs === "number") latencies.push(out.latencyMs);
    }
    const metric = summary.metrics && summary.metrics.latency_ms;
    if (metric && typeof metric.metric === "number") {
      // summary already averages; keep per-row for p50/p95
    }
    return {
      evaluator: evaluator.evalName,
      tylerAgreementAvg: scoreAvg(summary.scores, "TylerAgreement"),
      casePassAvg: scoreAvg(summary.scores, "CasePass"),
      latencies,
      experimentUrl: summary.experimentUrl || null,
      scores: summary.scores,
    };
  },

  reportRun(reports) {
    const failures: string[] = [];
    const allLatencies: number[] = [];
    let tylerAgreementAvg: number | null = null;
    let casePassAvg: number | null = null;
    let experimentUrl: string | null = null;
    let caseCount = 0;

    for (const r of reports as Array<{
      tylerAgreementAvg: number | null;
      casePassAvg: number | null;
      latencies: number[];
      experimentUrl: string | null;
    }>) {
      if (typeof r.tylerAgreementAvg === "number") {
        tylerAgreementAvg = r.tylerAgreementAvg;
      }
      if (typeof r.casePassAvg === "number") {
        casePassAvg = r.casePassAvg;
      }
      if (r.experimentUrl) experimentUrl = r.experimentUrl;
      for (const n of r.latencies || []) {
        if (Number.isFinite(n)) allLatencies.push(n);
      }
      caseCount += (r.latencies || []).length;
    }

    allLatencies.sort((a, b) => a - b);
    const p50 = percentile(allLatencies, 50);
    const p95 = percentile(allLatencies, 95);

    if (
      tylerAgreementAvg != null &&
      tylerAgreementAvg < THRESHOLDS.tylerAgreement
    ) {
      failures.push(
        `TylerAgreement ${tylerAgreementAvg.toFixed(3)} < ${THRESHOLDS.tylerAgreement}`,
      );
    }
    if (casePassAvg != null && casePassAvg < THRESHOLDS.casePass) {
      failures.push(
        `CasePass ${casePassAvg.toFixed(3)} < ${THRESHOLDS.casePass}`,
      );
    }

    // If neither score ran (e.g. empty dataset), fail closed when keys were present.
    if (tylerAgreementAvg == null && casePassAvg == null) {
      failures.push("No TylerAgreement or CasePass scores produced");
    }

    const report: GateReport = {
      ok: failures.length === 0,
      failures,
      tylerAgreementAvg,
      casePassAvg,
      latency_ms: { p50, p95, n: allLatencies.length },
      experimentUrl,
      thresholds: THRESHOLDS,
    };
    console.log(JSON.stringify({ kind: "tinker_ask_gate", ...report }, null, 2));

    for (const p of [
      "/opt/cursor/artifacts/ask-eval-gate.json",
      "evals/ask/last-gate-report.json",
    ]) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(report, null, 2));
      } catch {
        /* ignore */
      }
    }

    // Durable resume metric: POST latest pass rate to Production
    // /api/metrics (see RESUME_METRICS.md). Best-effort; never flips
    // the gate outcome. Production-only token — never Preview.
    const passRate =
      typeof report.tylerAgreementAvg === "number"
        ? report.tylerAgreementAvg
        : typeof report.casePassAvg === "number"
          ? report.casePassAvg
          : null;
    void persistEvalRunToMetricsApi({
      passRate,
      caseCount: caseCount || report.latency_ms.n || 0,
      experimentUrl: report.experimentUrl,
      report,
      ok: report.ok,
    });

    return failures.length === 0;
  },
});

async function persistEvalRunToMetricsApi(payload: {
  passRate: number | null;
  caseCount: number;
  experimentUrl: string | null;
  report: GateReport;
  ok: boolean;
}): Promise<void> {
  const token = String(process.env.TINKER_SERVICE_TOKEN || "").trim();
  if (!token || payload.passRate == null) return;
  const base = String(
    process.env.METRICS_BASE_URL || "https://tinker.beginner.work",
  ).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/metrics?action=record_eval`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Tinker-Caller": "ask-eval-gate",
      },
      body: JSON.stringify({
        project: "tinker-ask",
        passRate: payload.passRate,
        caseCount: payload.caseCount,
        passedCount: payload.ok ? payload.caseCount : undefined,
        experimentUrl: payload.experimentUrl || "",
        report: payload.report,
      }),
    });
    if (!res.ok) {
      console.error(
        "[ask-eval-gate] record_eval failed",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (err) {
    console.error(
      "[ask-eval-gate] record_eval error",
      err instanceof Error ? err.message : err,
    );
  }
}
