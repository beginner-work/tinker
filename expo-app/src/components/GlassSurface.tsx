/**
 * GlassSurface — one surface, two renderers.
 *
 * On iOS 26+ (`isLiquidGlassAvailable()` === true) this renders Apple's
 * native Liquid Glass via expo-glass-effect's <GlassView>. Everywhere the
 * native effect doesn't exist yet — the v0 web preview, Android, older iOS —
 * it degrades to an expo-blur <BlurView> with a translucent paper tint and a
 * hairline border, so the layout, contrast, and "frosted" read stay intact.
 *
 * Keep the public props renderer-agnostic: callers ask for a `tint`
 * ('paper' | 'accent' | 'clear') and a `radius`, never for a specific
 * backend. That way the same screen code lights up as real glass in an iOS
 * dev build and as a faithful fallback in preview.
 */

import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import {
  GlassView,
  isLiquidGlassAvailable,
  type GlassStyle,
} from "expo-glass-effect";
import { colors } from "../theme";

export const nativeGlass = isLiquidGlassAvailable();

type Tint = "paper" | "accent" | "clear";

type Props = {
  children?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  radius?: number;
  tint?: Tint;
  /** Maps to the native glass style; ignored by the fallback. */
  glass?: GlassStyle;
  interactive?: boolean;
};

const nativeTint: Record<Tint, string | undefined> = {
  paper: "rgba(255, 253, 247, 0.55)",
  accent: "rgba(165, 180, 252, 0.28)",
  clear: undefined,
};

// Fallback (BlurView) fills — translucent so the paper/rainbow behind shows.
const fallbackFill: Record<Tint, string> = {
  paper: "rgba(255, 253, 247, 0.62)",
  accent: "rgba(238, 242, 255, 0.55)",
  clear: "rgba(255, 253, 247, 0.35)",
};

export function GlassSurface({
  children,
  style,
  radius = 20,
  tint = "paper",
  glass = "regular",
  interactive = false,
}: Props) {
  const shape: ViewStyle = { borderRadius: radius, overflow: "hidden" };

  if (nativeGlass) {
    return (
      <GlassView
        glassEffectStyle={glass}
        tintColor={nativeTint[tint]}
        isInteractive={interactive}
        style={[shape, style]}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View style={[shape, styles.fallbackBorder, style]}>
      <BlurView
        intensity={Platform.OS === "web" ? 24 : 40}
        tint="light"
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: fallbackFill[tint] }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fallbackBorder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.6)",
    // A whisper of a lift so the frosted card separates from the paper.
    backgroundColor: colors.card,
  },
});
