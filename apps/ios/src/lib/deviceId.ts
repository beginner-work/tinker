import * as Application from "expo-application";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "tinker_anonymous_id";

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stable anonymous device id (`ra_…`). No PII. Persisted in SecureStore on
 * native; localStorage on web. Matches the resume-metrics anonymousId shape.
 */
export async function getAnonymousDeviceId(): Promise<string> {
  try {
    if (Platform.OS === "web") {
      const existing = globalThis.localStorage?.getItem(KEY);
      if (existing && /^ra_[a-f0-9]{16,64}$/i.test(existing)) return existing;
      const id = `ra_${randomHex(16)}`;
      globalThis.localStorage?.setItem(KEY, id);
      return id;
    }

    const existing = await SecureStore.getItemAsync(KEY);
    if (existing && /^ra_[a-f0-9]{16,64}$/i.test(existing)) return existing;

    let seed = "";
    if (Platform.OS === "ios") {
      seed = (await Application.getIosIdForVendorAsync()) || "";
    } else if (Platform.OS === "android") {
      seed = Application.getAndroidId() || "";
    }
    const hex = seed
      ? Array.from(seed)
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 32)
          .padEnd(16, "0")
      : randomHex(16);
    const id = `ra_${hex.slice(0, 32)}`;
    await SecureStore.setItemAsync(KEY, id);
    return id;
  } catch {
    return `ra_${randomHex(16)}`;
  }
}
