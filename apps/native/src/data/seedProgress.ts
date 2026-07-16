/**
 * Demo progress rows for View 1 feed shell.
 * Bodies are either allowlisted UI strings or verbatim pitch lines —
 * never model-authored narrative about fictional founders.
 */

import { STR } from "../strings";

export type ProgressItem = {
  id: string;
  /** Fixed UI section label from allowlist */
  kind: typeof STR.progress | typeof STR.coverage | typeof STR.connect;
  /** Verbatim founder / pitch line or allowlisted empty line */
  body: string;
  /** Relative time label — fixed microcopy only */
  when: string;
};

export const SEED_PROGRESS: ProgressItem[] = [
  {
    id: "1",
    kind: STR.coverage,
    body: STR.pitchTagline,
    when: STR.justNow,
  },
  {
    id: "2",
    kind: STR.progress,
    body: STR.pitchSolution,
    when: STR.today,
  },
  {
    id: "3",
    kind: STR.connect,
    body: STR.noSourceInFeed,
    when: STR.today,
  },
];
