/**
 * GlassButton — a pill action rendered on glass. On iOS 26 it's a real
 * interactive Liquid Glass capsule; on the web preview it's the frosted
 * fallback. The primary variant fills with the app's indigo accent (the
 * one place the house style lets a control lift), matching the welcome
 * "Start ->" button in styles.css.
 */

import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { GlassSurface } from "./GlassSurface";
import { colors, fonts, radius, space, type } from "../theme";

type Props = {
  label: string;
  onPress?: () => void;
  variant?: "glass" | "primary";
  disabled?: boolean;
  style?: ViewStyle;
};

export function GlassButton({
  label,
  onPress,
  variant = "glass",
  disabled = false,
  style,
}: Props) {
  if (variant === "primary") {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.primary,
          disabled && styles.disabled,
          pressed && !disabled && styles.primaryPressed,
          style,
        ]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryLabel}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <GlassSurface radius={radius.pill} tint="paper" interactive>
        <View style={styles.glassInner}>
          <Text style={styles.glassLabel}>{label}</Text>
        </View>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glassInner: {
    minHeight: 44,
    paddingHorizontal: space[6],
    alignItems: "center",
    justifyContent: "center",
  },
  glassLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: type.base,
    color: colors.foreground,
  },
  primary: {
    minHeight: 44,
    paddingHorizontal: space[6],
    borderRadius: radius.pill,
    backgroundColor: colors.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    // Shadows on buttons only — house rule.
    shadowColor: "#4338ca",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryPressed: { backgroundColor: colors.accentPress },
  primaryLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: type.base,
    color: "#ffffff",
  },
  disabled: { opacity: 0.5 },
});
