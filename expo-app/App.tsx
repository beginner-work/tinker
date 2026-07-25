/**
 * tinker (Expo) — a quiet place to be on the web, in React Native with
 * iOS 26 Liquid Glass. Root wiring: load the brand fonts (Fraunces +
 * Instrument Sans), provide safe-area insets, and drive a tiny state
 * machine between the three core surfaces — Seeds (welcome), the writing
 * interview, and Search — with a floating glass tab bar.
 */

import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_600SemiBold,
} from "@expo-google-fonts/fraunces";
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
} from "@expo-google-fonts/instrument-sans";

import { WelcomeScreen } from "./src/screens/WelcomeScreen";
import { WritingScreen } from "./src/screens/WritingScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { GlassTabBar, type TabKey } from "./src/components/GlassTabBar";
import { colors } from "./src/theme";

type Route =
  | { name: "seeds" }
  | { name: "search" }
  | { name: "writing"; seed: string };

function Shell() {
  const [route, setRoute] = useState<Route>({ name: "seeds" });

  const activeTab: TabKey = route.name === "search" ? "search" : "seeds";
  const showTabBar = route.name !== "writing";

  const startWriting = useCallback((seed: string) => {
    setRoute({ name: "writing", seed });
  }, []);

  return (
    <View style={styles.root}>
      {route.name === "seeds" && <WelcomeScreen onStart={startWriting} />}
      {route.name === "search" && <SearchScreen />}
      {route.name === "writing" && (
        <WritingScreen
          seed={route.seed}
          onExit={() => setRoute({ name: "seeds" })}
        />
      )}

      {showTabBar && (
        <GlassTabBar
          active={activeTab}
          onChange={(key) => setRoute({ name: key })}
        />
      )}
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  });

  if (!fontsLoaded) {
    return <View style={styles.root} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
