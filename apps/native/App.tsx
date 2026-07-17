import { useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { FirstOpenScreen } from "./src/screens/FirstOpenScreen";
import { FeedScreen } from "./src/screens/FeedScreen";
import { ConnectScreen } from "./src/screens/ConnectScreen";
import { CoverageScreen } from "./src/screens/CoverageScreen";
import { useTinkerFonts } from "./src/fonts";
import { colorsFor, type ColorMode } from "./src/theme";
import {
  EMPTY_CONNECTION,
  type ConnectionState,
} from "./src/data/connectSeeds";

type Screen = "firstOpen" | "explore" | "connect" | "coverage";

/**
 * Views 1–3: first-open → Explore → Connect → Coverage (Peep side-by-side).
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

  if (!fontsLoaded) {
    return (
      <View style={[styles.boot, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
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
      ) : (
        <FeedScreen
          mode={mode}
          connected={Boolean(connection.connectedAt)}
          onToggleMode={() => setMode((m) => (m === "dark" ? "light" : "dark"))}
          onNavigate={(target) => {
            if (target === "connect") setScreen("connect");
            else if (target === "coverage") setScreen("coverage");
            else if (
              target === "explore" ||
              target === "feed" ||
              target === "home"
            ) {
              setScreen("explore");
            }
          }}
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
