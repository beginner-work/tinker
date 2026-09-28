import { ReactNode, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import {
  GlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import { colors } from "../theme";

export type GlassShape = "circle" | "capsule" | "card" | "sheet";
export type GlassStyleName = "regular" | "clear" | "none";

type Availability = {
  liquid: boolean;
  api: boolean;
  reduceTransparency: boolean;
};

let cachedAvailability: Availability | null = null;

function readNativeFlags(): Pick<Availability, "liquid" | "api"> {
  if (Platform.OS !== "ios") {
    return { liquid: false, api: false };
  }
  try {
    return {
      liquid: !!isLiquidGlassAvailable(),
      api: !!isGlassEffectAPIAvailable(),
    };
  } catch {
    return { liquid: false, api: false };
  }
}

/** Native Liquid Glass is live only when both Expo flags pass and a11y allows it. */
export function canUseLiquidGlass(
  reduceTransparency = cachedAvailability?.reduceTransparency ?? false,
): boolean {
  const flags = readNativeFlags();
  return flags.liquid && flags.api && !reduceTransparency;
}

export function useLiquidGlassAvailability(): Availability & {
  ready: boolean;
  live: boolean;
} {
  const [state, setState] = useState<Availability>(() => ({
    ...readNativeFlags(),
    reduceTransparency: cachedAvailability?.reduceTransparency ?? false,
  }));
  const [ready, setReady] = useState(cachedAvailability != null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (!mounted) return;
        const next = { ...readNativeFlags(), reduceTransparency: !!enabled };
        cachedAvailability = next;
        setState(next);
        setReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        const next = { ...readNativeFlags(), reduceTransparency: false };
        cachedAvailability = next;
        setState(next);
        setReady(true);
      });

    const sub = AccessibilityInfo.addEventListener?.(
      "reduceTransparencyChanged",
      (enabled: boolean) => {
        const next = { ...readNativeFlags(), reduceTransparency: !!enabled };
        cachedAvailability = next;
        setState(next);
      },
    );

    return () => {
      mounted = false;
      // RN versions differ on subscription shape
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sub as any)?.remove?.();
    };
  }, []);

  return {
    ...state,
    ready,
    live: canUseLiquidGlass(state.reduceTransparency),
  };
}

type Props = {
  children?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Visual silhouette for radius defaults. */
  shape?: GlassShape;
  isInteractive?: boolean;
  /** Prefer clear over content-rich backgrounds; regular for chrome chips. */
  glassStyle?: GlassStyleName;
  /** Soft cream tint so glass stays on-brand with the paper UI. */
  tintColor?: string;
  /** Animate style transitions (iOS 26+) instead of opacity fades. */
  animate?: boolean;
  animationDuration?: number;
};

function radiusFor(shape: GlassShape): number {
  switch (shape) {
    case "circle":
    case "capsule":
      return 999;
    case "sheet":
      return 28;
    case "card":
    default:
      return 16;
  }
}

/**
 * Native Liquid Glass when the API is live; frosted cream fallback otherwise
 * (Android, web, older iOS, Expo Go on non-iOS-26, reduce-transparency).
 */
export function TinkerGlass({
  children,
  style,
  shape = "card",
  isInteractive = true,
  glassStyle = "regular",
  tintColor = "rgba(255, 253, 247, 0.22)",
  animate = false,
  animationDuration = 0.35,
}: Props) {
  const radius = radiusFor(shape);
  const flat = StyleSheet.flatten(style) ?? {};
  const live = canUseLiquidGlass();

  if (live) {
    const effect =
      animate || glassStyle === "none"
        ? {
            style: glassStyle,
            animate: true,
            animationDuration,
          }
        : glassStyle;

    return (
      <GlassView
        style={[{ borderRadius: radius, overflow: "hidden" }, flat]}
        glassEffectStyle={effect}
        isInteractive={isInteractive}
        colorScheme="light"
        tintColor={tintColor}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View style={[styles.fallback, { borderRadius: radius }, flat]}>
      {children}
    </View>
  );
}

type GroupProps = {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Distance at which sibling glass surfaces start to merge. */
  spacing?: number;
};

/** Groups sibling GlassViews so Liquid Glass morphs between them. */
export function TinkerGlassGroup({
  children,
  style,
  spacing = 12,
}: GroupProps) {
  if (canUseLiquidGlass()) {
    return (
      <GlassContainer spacing={spacing} style={style}>
        {children}
      </GlassContainer>
    );
  }
  return <View style={style}>{children}</View>;
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "rgba(255, 253, 247, 0.86)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: "#2d2a26",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
