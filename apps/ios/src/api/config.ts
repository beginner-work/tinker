import Constants from "expo-constants";

export const API_BASE_URL = String(
  Constants.expoConfig?.extra?.apiBaseUrl ||
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    "https://tinker.beginner.work",
).replace(/\/$/, "");

/** Milestone 1 iOS client always reports platform=ios. */
export const PLATFORM = "ios" as const;
