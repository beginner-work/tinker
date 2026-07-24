import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TinkerGlass } from "./TinkerGlass";
import { colors } from "../theme";

export type WritingMode = "ai" | "noai";

type Props = {
  mode: WritingMode;
  offline?: boolean;
  visible?: boolean;
  onChange: (mode: WritingMode) => void;
};

export function ModeNav({
  mode,
  offline = false,
  visible = true,
  onChange,
}: Props) {
  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <TinkerGlass shape="capsule" style={styles.bar}>
        <Segment
          label="AI"
          icon="sparkles"
          selected={mode === "ai"}
          disabled={offline}
          onPress={() => onChange("ai")}
        />
        <Segment
          label="No AI"
          icon="create-outline"
          selected={mode === "noai"}
          disabled={false}
          onPress={() => onChange("noai")}
        />
      </TinkerGlass>
      {offline ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>You're offline</Text>
        </View>
      ) : null}
    </View>
  );
}

function Segment({
  label,
  icon,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={[
        styles.segment,
        selected && styles.segmentSelected,
        disabled && styles.segmentDisabled,
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={selected ? "#fff" : colors.muted}
      />
      <Text style={[styles.label, selected && styles.labelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: "center",
    zIndex: 40,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    padding: 3,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  segmentSelected: {
    backgroundColor: colors.accentStrong,
  },
  segmentDisabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: colors.muted,
    fontFamily: "InstrumentSans_600SemiBold",
  },
  labelSelected: {
    color: "#fff",
  },
  offline: {
    marginTop: -4,
    paddingHorizontal: 16,
    paddingTop: 5,
    paddingBottom: 4,
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    backgroundColor: "rgba(45, 42, 38, 0.85)",
  },
  offlineText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    fontFamily: "InstrumentSans_600SemiBold",
  },
});
