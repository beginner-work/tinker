import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Fraunces_500Medium } from "@expo-google-fonts/fraunces";
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
} from "@expo-google-fonts/instrument-sans";
import { DrawerToggle } from "./src/components/DrawerToggle";
import { ModeNav, WritingMode } from "./src/components/ModeNav";
import { SidebarDrawer } from "./src/components/SidebarDrawer";
import { WelcomeBody } from "./src/components/WelcomeBody";
import { useLiquidGlassAvailability } from "./src/components/TinkerGlass";
import { colors, space } from "./src/theme";

function AppShell() {
  const glass = useLiquidGlassAvailability();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<WritingMode>("ai");
  const [picked, setPicked] = useState<string | null>(null);

  const onPickPlace = useCallback((id: string) => {
    setPicked(id);
  }, []);

  const liquidFlag =
    Platform.OS === "ios" ? String(glass.liquid) : "n/a";
  const apiFlag = Platform.OS === "ios" ? String(glass.api) : "n/a";

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <WelcomeBody
        mode={mode}
        onPickPlace={onPickPlace}
        selectedId={picked}
      />

      <DrawerToggle
        hidden={drawerOpen}
        onPress={() => setDrawerOpen(true)}
      />
      <ModeNav
        mode={mode}
        visible={!drawerOpen}
        onChange={setMode}
      />

      <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <View style={styles.status} pointerEvents="none">
        <Text style={styles.statusText}>
          {!glass.ready
            ? "Liquid Glass: checking…"
            : glass.live
              ? "Liquid Glass: live (native)"
              : glass.reduceTransparency
                ? "Liquid Glass: fallback (Reduce Transparency)"
                : "Liquid Glass: fallback chip (need iOS 26 + Expo Go)"}
        </Text>
        <Text style={styles.statusMeta}>
          platform {Platform.OS} · liquid={liquidFlag} · api={apiFlag}
          {picked ? ` · picked ${picked}` : ""}
        </Text>
      </View>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.accentStrong} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  status: {
    position: "absolute",
    left: space[5],
    right: space[5],
    bottom: 88,
    alignItems: "center",
  },
  statusText: {
    fontFamily: "InstrumentSans_500Medium",
    fontSize: 12,
    color: colors.forest,
    textAlign: "center",
  },
  statusMeta: {
    marginTop: 2,
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
  },
});
