import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { AppChrome } from "../src/components/AppChrome";
import { WelcomeBody } from "../src/components/WelcomeBody";
import { useAuth } from "../src/auth/AuthContext";
import { createDraft } from "../src/lib/drafts";
import { colors, fonts, space, type } from "../src/theme";
import {
  canUseLiquidGlass,
  useLiquidGlassAvailability,
} from "../src/components/TinkerGlass";
import { Platform } from "react-native";
import type { WritingMode } from "../src/components/ModeNav";

const PLACE_LABELS: Record<string, string> = {
  cafe: "Cafe",
  home: "Home",
  work: "Work",
  other: "Somewhere else",
};

export default function WelcomeScreen() {
  const { signedIn } = useAuth();
  const glass = useLiquidGlassAvailability();
  const [mode, setMode] = useState<WritingMode>("ai");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPickPlace = useCallback(
    async (id: string) => {
      setPicked(id);
      if (signedIn === false) {
        router.push("/sign-in");
        return;
      }
      if (busy) return;
      setBusy(true);
      try {
        const seed = PLACE_LABELS[id] || id;
        if (mode === "noai") {
          router.push({ pathname: "/freewrite", params: { seed } });
          return;
        }
        const draft = await createDraft(seed);
        router.push({ pathname: "/write", params: { id: draft.id, seed } });
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, signedIn],
  );

  const liquidFlag = Platform.OS === "ios" ? String(glass.liquid) : "n/a";
  const apiFlag = Platform.OS === "ios" ? String(glass.api) : "n/a";

  return (
    <AppChrome mode={mode} onModeChange={setMode}>
      <View style={styles.root}>
        <WelcomeBody
          mode={mode}
          onPickPlace={onPickPlace}
          selectedId={picked}
        />
        <View style={styles.status} pointerEvents="none">
          <Text style={styles.statusText}>
            {!glass.ready
              ? "Liquid Glass: checking…"
              : canUseLiquidGlass(glass.reduceTransparency)
                ? "Liquid Glass: live (native)"
                : glass.reduceTransparency
                  ? "Liquid Glass: fallback (Reduce Transparency)"
                  : "Liquid Glass: fallback chip"}
          </Text>
          <Text style={styles.statusMeta}>
            platform {Platform.OS} · liquid={liquidFlag} · api={apiFlag}
            {picked ? ` · ${picked}` : ""}
          </Text>
        </View>
      </View>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  status: {
    position: "absolute",
    left: space[5],
    right: space[5],
    bottom: 88,
    alignItems: "center",
  },
  statusText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.forest,
    textAlign: "center",
  },
  statusMeta: {
    marginTop: 2,
    fontFamily: fonts.sans,
    fontSize: type.micro,
    color: colors.muted,
    textAlign: "center",
  },
});
