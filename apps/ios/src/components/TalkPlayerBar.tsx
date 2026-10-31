import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, space } from "@/src/theme/tokens";

type Props = {
  isPlaying: boolean;
  disabled?: boolean;
  progress: number;
  onPlayPause: () => void;
  onAsk: () => void;
};

/** Fixed pill player bar — mirrors .ll-talk-player__bar on lindowlabs. */
export function TalkPlayerBar({
  isPlaying,
  disabled,
  progress,
  onPlayPause,
  onAsk,
}: Props) {
  const insets = useSafeAreaInsets();
  const pct = Math.max(0, Math.min(1, progress));

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar} accessibilityRole="toolbar">
        <Pressable
          style={styles.circleBtn}
          onPress={onPlayPause}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Listen"}
        >
          <Text style={styles.circleGlyph}>{isPlaying ? "❚❚" : "▶"}</Text>
        </Pressable>

        <View style={styles.wave}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct * 100}%` }]} />
          </View>
        </View>

        <Pressable
          style={styles.askBtn}
          onPress={onAsk}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Ask"
        >
          <Text style={styles.askText}>Ask</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: space[4],
  },
  bar: {
    width: "100%",
    maxWidth: 420,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.barBg,
    borderWidth: 1,
    borderColor: colors.barBorder,
    borderRadius: 999,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 10,
    shadowColor: "#2d2a26",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  circleBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.btnBg,
    borderWidth: 1,
    borderColor: "rgba(45,42,38,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  circleGlyph: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.inkSoft,
  },
  wave: {
    flex: 1,
    height: 28,
    justifyContent: "center",
  },
  track: {
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(45,42,38,0.1)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: colors.forest,
    borderRadius: 999,
  },
  askBtn: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.btnBg,
    borderWidth: 1,
    borderColor: "rgba(45,42,38,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  askText: {
    fontFamily: fonts.essay,
    fontSize: 14,
    color: colors.inkSoft,
    letterSpacing: -0.2,
  },
});
