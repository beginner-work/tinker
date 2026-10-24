/**
 * Raise fail rate on the better app until a local burn signal trips.
 * (Full Prometheus alert evaluation needs docker compose up.)
 */
import { setFailRate, totals, server } from "../better/app/server.js";

const PORT = Number(process.env.PORT || 5092);

function successRatio() {
  const ok = totals["200"];
  const bad = totals["500"];
  const n = ok + bad;
  return n ? ok / n : 1;
}

server.listen(PORT, async () => {
  console.log("mock incident against better app");
  setFailRate(0.02);
  for (let i = 0; i < 50; i += 1) {
    await fetch(`http://127.0.0.1:${PORT}/checkout`);
  }
  console.log("warm_ratio", successRatio().toFixed(4));

  setFailRate(0.4);
  for (let i = 0; i < 200; i += 1) {
    await fetch(`http://127.0.0.1:${PORT}/checkout`);
  }
  const ratio = successRatio();
  console.log("incident_ratio", ratio.toFixed(4));
  console.log(ratio < 0.99 ? "burn_signal=yes" : "burn_signal=no");
  console.log("See better/runbook.md and better/alerts/burn-rate.yml");
  server.close();
  if (ratio >= 0.99) process.exit(1);
});
