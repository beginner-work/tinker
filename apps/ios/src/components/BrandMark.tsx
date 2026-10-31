import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts, space } from "@/src/theme/tokens";

/** Hero-level brand signal for the first viewport. */
export function BrandMark({ size = "hero" }: { size?: "hero" | "compact" }) {
  const hero = size === "hero";
  return (
    <View style={styles.wrap} accessibilityRole="header">
      <LinearGradient
        colors={[
          colors.logoPink,
          colors.logoOrange,
          colors.logoYellow,
          colors.logoLeaf,
          colors.logoMint,
          colors.logoSky,
          colors.logoPurple,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.wedge, hero ? styles.wedgeHero : styles.wedgeCompact]}
      />
      <Text style={[styles.brand, hero ? styles.brandHero : styles.brandCompact]}>
        tinker
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    paddingTop: space[2],
  },
  wedge: {
    position: "absolute",
    top: 0,
    left: 0,
    opacity: 0.9,
  },
  wedgeHero: {
    width: 160,
    height: 160,
    borderBottomRightRadius: 160,
  },
  wedgeCompact: {
    width: 56,
    height: 56,
    borderBottomRightRadius: 56,
  },
  brand: {
    fontFamily: fonts.display,
    color: colors.ink,
    letterSpacing: -0.6,
  },
  brandHero: {
    fontSize: 48,
    lineHeight: 52,
    marginTop: space[7],
  },
  brandCompact: {
    fontSize: 28,
    lineHeight: 32,
    marginTop: space[5],
  },
});
