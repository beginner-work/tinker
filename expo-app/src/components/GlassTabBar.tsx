/**
 * GlassTabBar — a floating Liquid Glass tab bar, the signature iOS 26
 * surface. Two tabs: Seeds (the writing home) and Search. On iOS 26 it's
 * real glass; in preview it's the frosted fallback. The active tab gets a
 * small glass pill behind it, echoing Apple's selected-tab treatment.
 */

import Svg, { Path, Circle, Line } from "react-native-svg";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassSurface } from "./GlassSurface";
import { colors, fonts, radius, space, type } from "../theme";

export type TabKey = "seeds" | "search";

function Icon({ name, active }: { name: TabKey; active: boolean }) {
  const stroke = active ? colors.accentStrong : colors.muted;
  if (name === "seeds") {
    // A sprout — the "seed" mark.
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path d="M12 21V11" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
        <Path d="M12 11C12 8 9.5 6 6 6c0 3 2.5 5 6 5Z" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
        <Path d="M12 11c0-2.5 2-4.5 5-4.5 0 2.5-2 4.5-5 4.5Z" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
      </Svg>
    );
  }
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={7} stroke={stroke} strokeWidth={2} />
      <Line x1={16.5} y1={16.5} x2={21} y2={21} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "seeds", label: "Seeds" },
  { key: "search", label: "Search" },
];

export function GlassTabBar({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + space[3] }]}>
      <GlassSurface radius={radius.pill} tint="paper" interactive style={styles.bar}>
        {TABS.map((tab) => {
          const isActive = active === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onChange(tab.key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={styles.tab}
            >
              {isActive ? (
                <GlassSurface radius={radius.pill} tint="accent" style={styles.pill}>
                  <Icon name={tab.key} active />
                  <Text style={[styles.label, styles.labelActive]}>{tab.label}</Text>
                </GlassSurface>
              ) : (
                <View style={styles.pill}>
                  <Icon name={tab.key} active={false} />
                  <Text style={styles.label}>{tab.label}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </GlassSurface>
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
    paddingHorizontal: space[5],
  },
  bar: {
    flexDirection: "row",
    padding: space[1],
    gap: space[1],
  },
  tab: { borderRadius: radius.pill },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: space[5],
    minHeight: 44,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: type.body,
    color: colors.muted,
  },
  labelActive: { color: colors.accentStrong, fontFamily: fonts.sansSemi },
});
