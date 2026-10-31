import { ExpoConfig, ConfigContext } from "expo/config";

const APP_NAME = "Tinker";
const SLUG = "tinker-ios";
const BUNDLE_ID = "work.beginner.tinker";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: SLUG,
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "tinker",
  userInterfaceStyle: "light",
  // Expo SDK 58 enables the React Native New Architecture by default.
  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
    buildNumber: "1",
    infoPlist: {
      NSMicrophoneUsageDescription:
        "Tinker listens when you ask a spoken question about the text being read.",
      NSSpeechRecognitionUsageDescription:
        "Tinker turns your spoken question into text so it can answer from what you are reading.",
      UIBackgroundModes: ["audio"],
      CFBundleDisplayName: "Tinker",
      LSApplicationQueriesSchemes: ["https", "http"],
    },
    associatedDomains: ["applinks:tinker.beginner.work"],
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#f3efe6",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    package: BUNDLE_ID,
    predictiveBackGestureEnabled: false,
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#f3efe6",
      },
    ],
    [
      "expo-share-intent",
      {
        iosActivationRules: {
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsText: true,
        },
        androidIntentFilters: ["text/*", "text/plain"],
      },
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission:
          "Allow Tinker to use the microphone for spoken questions.",
        speechRecognitionPermission:
          "Allow Tinker to turn your spoken question into text.",
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission:
          "Allow Tinker to use the microphone for spoken questions.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || "https://tinker.beginner.work",
    eas: {
      projectId: process.env.EAS_PROJECT_ID || "00000000-0000-0000-0000-000000000000",
    },
  },
  owner: process.env.EAS_OWNER || undefined,
});
