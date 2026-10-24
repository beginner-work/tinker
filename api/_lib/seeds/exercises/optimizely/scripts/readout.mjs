import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInstance } from "@optimizely/optimizely-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const datafile = JSON.parse(
  fs.readFileSync(path.join(here, "..", "lib", "datafile.json"), "utf8")
);
const optly = createInstance({ datafile, datafileOptions: { autoUpdate: false } });

const counts = {};
for (let i = 0; i < 1000; i += 1) {
  const user = optly.createUserContext(`user_${i}`);
  const d = user.decide("onboarding_checklist_experiment");
  const key = d.variationKey || "checklist_v1";
  counts[key] = (counts[key] || 0) + 1;
}
console.log("local_datafile_split=", counts);
