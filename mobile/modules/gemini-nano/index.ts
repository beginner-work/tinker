/* JS surface for the local GeminiNano Expo module (Android-only).
 *
 * requireOptionalNativeModule keeps every non-Android environment safe:
 * on iOS, web, and in Expo Go the native module is absent and this
 * wrapper degrades to "unsupported", which the assistant layer treats
 * as "use Claude via the server".
 */

import { requireOptionalNativeModule } from "expo-modules-core";

type NativeModule = {
  getAvailability(): Promise<string>;
  downloadModel(): Promise<string>;
  generate(prompt: string, maxOutputTokens: number, temperature: number): Promise<string>;
};

const native = requireOptionalNativeModule<NativeModule>("GeminiNano");

export type NanoAvailability =
  | "available" // model on device, ready for inference
  | "downloadable" // device supported, model not fetched yet
  | "downloading" // fetch in flight
  | "unavailable" // AICore present but feature blocked (device/region)
  | "unsupported"; // no native module (iOS, web, Expo Go, old Android)

export async function availability(): Promise<NanoAvailability> {
  if (!native) return "unsupported";
  try {
    return (await native.getAvailability()) as NanoAvailability;
  } catch {
    return "unavailable";
  }
}

/* Kicks off the AICore model download; resolves with the availability
 * after the request. Safe to call when already available. */
export async function downloadModel(): Promise<NanoAvailability> {
  if (!native) return "unsupported";
  try {
    return (await native.downloadModel()) as NanoAvailability;
  } catch {
    return "unavailable";
  }
}

export async function generate(
  prompt: string,
  opts: { maxOutputTokens?: number; temperature?: number } = {},
): Promise<string> {
  if (!native) throw new Error("Gemini Nano is not available on this platform.");
  return native.generate(prompt, opts.maxOutputTokens ?? 1024, opts.temperature ?? 0.4);
}
