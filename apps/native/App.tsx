import { useState } from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { FirstOpenScreen } from "./src/screens/FirstOpenScreen";
import { FeedScreen } from "./src/screens/FeedScreen";
import { theme } from "./src/theme";

/**
 * View 1 shell — first-open quote, then dark LinkedIn-style progress feed.
 * Build prompt: build-prompts/product-oriented-dev-feed.md
 */
export default function App() {
  const [phase, setPhase] = useState<"firstOpen" | "feed">("firstOpen");

  return (
    <SafeAreaView style={styles.safe} testID="tinker-native-root">
      <StatusBar style="light" />
      {phase === "firstOpen" ? (
        <FirstOpenScreen onContinue={() => setPhase("feed")} />
      ) : (
        <FeedScreen />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
});
