import { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, space } from "@/src/theme/tokens";

const AVATAR = require("../../assets/brand/profile-square.jpg");

const WAVE_COLORS = [
  "#f9a8d4",
  "#fdba74",
  "#fde68a",
  "#7bc47a",
  "#6ee7b7",
  "#7dd3fc",
  "#c8b6e2",
  "#a5b4fc",
];

type Props = {
  isPlaying: boolean;
  disabled?: boolean;
  progress: number;
  avatarUri?: string | number | null;
  onPlayPause: () => void;
  onAsk: () => void;
};

function MicIcon() {
  return (
    <View style={micStyles.wrap} accessibilityElementsHidden>
      <View style={micStyles.head} />
      <View style={micStyles.yoke} />
      <View style={micStyles.stem} />
      <View style={micStyles.base} />
    </View>
  );
}

function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <View style={muteStyles.wrap} accessibilityElementsHidden>
      <View style={muteStyles.speaker}>
        <View style={muteStyles.neck} />
        <View style={muteStyles.bell} />
      </View>
      {!muted ? (
        <View style={muteStyles.waves}>
          <View style={[muteStyles.waveArc, muteStyles.wave1]} />
          <View style={[muteStyles.waveArc, muteStyles.wave2]} />
        </View>
      ) : (
        <View style={muteStyles.slash} />
      )}
    </View>
  );
}

function PauseIcon() {
  return (
    <View style={pauseStyles.wrap} accessibilityElementsHidden>
      <View style={pauseStyles.bar} />
      <View style={pauseStyles.bar} />
    </View>
  );
}

function PlayIcon() {
  return (
    <View style={playStyles.wrap} accessibilityElementsHidden>
      <View style={playStyles.tri} />
    </View>
  );
}

/** Fixed pill player bar — mirrors `.ll-talk-player__bar` on lindowlabs. */
export function TalkPlayerBar({
  isPlaying,
  disabled,
  progress,
  avatarUri,
  onPlayPause,
  onAsk,
}: Props) {
  const insets = useSafeAreaInsets();
  // Match lindowlabs default muted chrome in the pill bar.
  const [muted, setMuted] = useState(true);
  const pct = Math.max(0, Math.min(1, progress));

  const bars = useMemo(() => {
    const n = 42;
    const out: { h: number; color: string }[] = [];
    for (let i = 0; i < n; i++) {
      const phase = (i / n) * Math.PI * 4;
      const envelope =
        0.28 +
        0.45 * Math.abs(Math.sin(phase + pct * 7)) +
        0.27 * Math.abs(Math.sin(phase * 1.7 + 1.2));
      const playingBoost = isPlaying ? 1 : 0.4;
      const h = Math.max(3, Math.round(5 + envelope * 32 * playingBoost));
      out.push({ h, color: WAVE_COLORS[i % WAVE_COLORS.length] });
    }
    return out;
  }, [isPlaying, pct]);

  const avatarSource =
    typeof avatarUri === "string" && avatarUri
      ? { uri: avatarUri }
      : typeof avatarUri === "number"
        ? avatarUri
        : AVATAR;

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar} accessibilityRole="toolbar">
        <Image source={avatarSource} style={styles.avatar} accessibilityLabel="Source" />

        <View style={styles.wave} accessibilityElementsHidden>
          {bars.map((b, i) => (
            <View
              key={i}
              style={[
                styles.seg,
                {
                  height: b.h,
                  backgroundColor: b.color,
                  opacity: i / bars.length <= pct + 0.1 ? 1 : 0.32,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable
            style={styles.circleBtn}
            onPress={onPlayPause}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </Pressable>

          <Pressable
            style={styles.askBtn}
            onPress={onAsk}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Ask"
          >
            <MicIcon />
            <Text style={styles.askLabel}>Ask</Text>
          </Pressable>

          <Pressable
            style={styles.circleBtn}
            onPress={() => setMuted((m) => !m)}
            accessibilityRole="button"
            accessibilityLabel={muted ? "Unmute" : "Mute"}
          >
            <MuteIcon muted={muted} />
          </Pressable>
        </View>
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
    backgroundColor: "rgba(255, 253, 247, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(45, 42, 38, 0.14)",
    borderRadius: 999,
    paddingVertical: 8,
    paddingLeft: 9,
    paddingRight: 12,
    shadowColor: "#2d2a26",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: colors.cream,
  },
  wave: {
    flex: 1,
    height: 38,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1.5,
    paddingBottom: 2,
  },
  seg: {
    flex: 1,
    minWidth: 1.5,
    maxWidth: 4,
    borderRadius: 999,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  circleBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(45,42,38,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  askBtn: {
    height: 36,
    minWidth: 36,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(45,42,38,0.12)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  askLabel: {
    fontFamily: fonts.essay,
    fontSize: 12.5,
    color: colors.inkSoft,
    letterSpacing: -0.15,
  },
});

const micStyles = StyleSheet.create({
  wrap: { width: 11, height: 15, alignItems: "center", justifyContent: "flex-end" },
  head: {
    width: 7,
    height: 9,
    borderRadius: 3.5,
    backgroundColor: colors.inkSoft,
  },
  yoke: {
    width: 11,
    height: 5,
    borderWidth: 1.4,
    borderTopWidth: 0,
    borderColor: colors.inkSoft,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    marginTop: -2,
  },
  stem: {
    width: 1.4,
    height: 2.5,
    backgroundColor: colors.inkSoft,
  },
  base: {
    width: 7,
    height: 1.4,
    borderRadius: 1,
    backgroundColor: colors.inkSoft,
  },
});

const muteStyles = StyleSheet.create({
  wrap: {
    width: 18,
    height: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  speaker: {
    flexDirection: "row",
    alignItems: "center",
  },
  neck: {
    width: 3,
    height: 5,
    backgroundColor: colors.inkSoft,
    borderTopLeftRadius: 1,
    borderBottomLeftRadius: 1,
  },
  bell: {
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 7,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: colors.inkSoft,
    marginLeft: -1,
  },
  waves: {
    marginLeft: 1,
    height: 12,
    width: 6,
    justifyContent: "center",
  },
  waveArc: {
    borderColor: colors.inkSoft,
    borderRightWidth: 1.5,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderLeftWidth: 0,
    borderRadius: 8,
  },
  wave1: { width: 4, height: 7, position: "absolute", left: 0 },
  wave2: { width: 6, height: 11, position: "absolute", left: 0 },
  slash: {
    position: "absolute",
    width: 16,
    height: 1.5,
    backgroundColor: colors.inkSoft,
    transform: [{ rotate: "-40deg" }],
  },
});

const pauseStyles = StyleSheet.create({
  wrap: { flexDirection: "row", gap: 3, alignItems: "center" },
  bar: {
    width: 3,
    height: 12,
    borderRadius: 1,
    backgroundColor: colors.inkSoft,
  },
});

const playStyles = StyleSheet.create({
  wrap: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },
  tri: {
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: colors.inkSoft,
  },
});
