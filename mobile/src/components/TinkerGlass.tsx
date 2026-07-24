import { ReactNode } from "react";
import { Platform, StyleSheet, View, ViewStyle } from "react-native";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import { colors } from "../theme";

export function canUseLiquidGlass(): boolean {
  if (Platform.OS !== "ios") return false;
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}

type Props = {
  children?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Circle for drawer toggle; capsule for mode nav. */
  shape: "circle" | "capsule";
  isInteractive?: boolean;
};

/**
 * Native Liquid Glass when the API is live; frosted cream fallback otherwise
 * (Android, web, older iOS, Expo Go on non-iOS-26).
 */
export function TinkerGlass({
  children,
  style,
  shape,
  isInteractive = true,
}: Props) {
  const radius = shape === "circle" ? 999 : 999;
  const flat = StyleSheet.flatten(style) ?? {};

  if (canUseLiquidGlass()) {
    return (
      <GlassView
        style={[{ borderRadius: radius, overflow: "hidden" }, flat]}
        glassEffectStyle="regular"
        isInteractive={isInteractive}
        colorScheme="light"
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { borderRadius: radius },
        flat,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "rgba(255, 253, 247, 0.86)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    // Soft separation when native glass isn't available
    shadowColor: "#2d2a26",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
