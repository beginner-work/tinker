import { useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { FirstOpenScreen } from "./src/screens/FirstOpenScreen";
import { FeedScreen } from "./src/screens/FeedScreen";
import { ConnectScreen } from "./src/screens/ConnectScreen";
import { CoverageScreen } from "./src/screens/CoverageScreen";
import { ProgressScreen } from "./src/screens/ProgressScreen";
import { useTinkerFonts } from "./src/fonts";
import { colorsFor, type ColorMode } from "./src/theme";
import {
  EMPTY_CONNECTION,
  type ConnectionState,
} from "./src/data/connectSeeds";

type Screen =
  | "firstOpen"
  | "explore"
  | "connect"
  | "coverage"
  | "progress"
  | "feed";

/**
 * Views 1–4: first-open → Explore → Connect → Coverage → Progress feed.
 * Fonts: Fraunces + Instrument Sans (tinker design system).
 * Build prompt: build-prompts/product-oriented-dev-feed.md
 */
export default function App() {
  const fontsLoaded = useTinkerFonts();
  const [screen, setScreen] = useState<Screen>("firstOpen");
  const [mode, setMode] = useState<ColorMode>("light");
  const [connection, setConnection] =
    useState<ConnectionState>(EMPTY_CONNECTION);
  const c = colorsFor(mode);
  const connected = Boolean(connection.connectedAt);

  if (!fontsLoaded) {
    return (
      <View style={[styles.boot, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  function onNavigate(target: string) {
    if (target === "connect") setScreen("connect");
    else if (target === "coverage") setScreen("coverage");
    else if (target === "progress" || target === "feed") setScreen(target as Screen);
    else if (target === "explore" || target === "home") setScreen("explore");
  }

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: c.background }]}
      testID="tinker-native-root"
    >
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      {screen === "firstOpen" ? (
        <FirstOpenScreen mode={mode} onContinue={() => setScreen("explore")} />
      ) : screen === "connect" ? (
        <ConnectScreen
          mode={mode}
          connection={connection}
          onConnectionChange={setConnection}
          onBack={() => setScreen("explore")}
        />
      ) : screen === "coverage" ? (
        <CoverageScreen
          mode={mode}
          connection={connection}
          onBack={() => setScreen("explore")}
          onConnect={() => setScreen("connect")}
        />
      ) : screen === "progress" || screen === "feed" ? (
        <ProgressScreen
          mode={mode}
          connected={connected}
          activeTab={screen === "feed" ? "feed" : "progress"}
          onToggleMode={() => setMode((m) => (m === "dark" ? "light" : "dark"))}
          onNavigate={onNavigate}
        />
      ) : (
        <FeedScreen
          mode={mode}
          connected={connected}
          onToggleMode={() => setMode((m) => (m === "dark" ? "light" : "dark"))}
          onNavigate={onNavigate}
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
