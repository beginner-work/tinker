import { useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { FirstOpenScreen } from "./src/screens/FirstOpenScreen";
import { FeedScreen } from "./src/screens/FeedScreen";
import { useTinkerFonts } from "./src/fonts";
import { colorsFor, type ColorMode } from "./src/theme";

/**
 * View 1 — first-open quote, then GitHub Explore–shaped progress surface.
 * Fonts: Fraunces + Instrument Sans (tinker design system).
 * Build prompt: build-prompts/product-oriented-dev-feed.md
 */
export default function App() {
  const fontsLoaded = useTinkerFonts();
  const [phase, setPhase] = useState<"firstOpen" | "feed">("firstOpen");
  // Light matches the GitHub Explore reference; Dark remains a toggle.
  const [mode, setMode] = useState<ColorMode>("light");
  const c = colorsFor(mode);

  if (!fontsLoaded) {
    return (
      <View style={[styles.boot, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} testID="tinker-native-root">
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      {phase === "firstOpen" ? (
        <FirstOpenScreen mode={mode} onContinue={() => setPhase("feed")} />
      ) : (
        <FeedScreen
          mode={mode}
          onToggleMode={() => setMode((m) => (m === "dark" ? "light" : "dark"))}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
