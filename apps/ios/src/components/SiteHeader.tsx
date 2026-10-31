import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "@/src/theme/tokens";

const LOGO = require("../../assets/brand/lindow-labs-icon.png");

type Props = {
  /** Product wordmark — matches lindowlabs header layout. */
  wordmark?: string;
  onBrandPress?: () => void;
};

/**
 * Sticky header matching lindowlabs `.nav`: logo mark + wordmark, Blog grid,
 * LinkedIn icon, bottom divider.
 */
export function SiteHeader({ wordmark = "Tinker", onBrandPress }: Props) {
  return (
    <View style={styles.nav} accessibilityRole="header">
      <Pressable
        style={styles.brand}
        onPress={onBrandPress}
        accessibilityRole="link"
        accessibilityLabel={`${wordmark} home`}
      >
        <Image source={LOGO} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text style={styles.wordmark}>{wordmark}</Text>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          style={styles.blog}
          onPress={() => Linking.openURL("https://lindowlabs.dev/blog")}
          accessibilityRole="link"
          accessibilityLabel="Blog"
        >
          <View style={styles.grid} accessibilityElementsHidden>
            <View style={styles.gridCell} />
            <View style={styles.gridCell} />
            <View style={styles.gridCell} />
            <View style={styles.gridCell} />
          </View>
          <Text style={styles.blogLabel}>Blog</Text>
        </Pressable>
        <Pressable
          style={styles.linkedin}
          onPress={() => Linking.openURL("https://www.linkedin.com/in/tlindow")}
          accessibilityRole="link"
          accessibilityLabel="LinkedIn"
        >
          <Text style={styles.linkedinGlyph}>in</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 20,
    paddingBottom: 19,
    paddingHorizontal: 22,
    backgroundColor: "rgba(255, 253, 247, 0.94)",
    borderBottomWidth: StyleSheet.hairlineWidth < 1 ? 1 : StyleSheet.hairlineWidth,
    borderBottomColor: "#ede8e0",
    zIndex: 50,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  wordmark: {
    fontFamily: fonts.bodySemi,
    fontSize: 16,
    letterSpacing: -0.25,
    color: colors.ink,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  blog: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  grid: {
    width: 16,
    height: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
  },
  gridCell: {
    width: 6,
    height: 6,
    borderRadius: 1.5,
    borderWidth: 1.5,
    borderColor: colors.inkSoft,
  },
  blogLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  linkedin: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  linkedinGlyph: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.bg,
    marginTop: -1,
  },
});
