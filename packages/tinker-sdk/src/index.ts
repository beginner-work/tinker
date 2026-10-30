/** @tinker/sdk — server client + browser Ask pill.
 *
 * Prefer deep imports in production bundles:
 *   import { TinkerClient } from "@tinker/sdk/server";
 *   import { TinkerAsk } from "@tinker/sdk/browser";
 *
 * This root entry re-exports both for convenience in Node tests / docs.
 */

export * from "./server";
export * from "./browser";
