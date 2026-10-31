import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, space } from "@/src/theme/tokens";

type Props = {
  author?: string;
  authorUnknown?: boolean;
  siteName?: string;
  siteDomain?: string;
  sourceUrl?: string;
};

/**
 * Top-of-reading attribution: "By <Author>" + site name linked to source.
 * Never invents — empty author → "Author unknown".
 */
export function SourceByline({
  author,
  authorUnknown,
  siteName,
  siteDomain,
  sourceUrl,
}: Props) {
  const known = String(author || "").trim();
  const by = known && !authorUnknown ? `By ${known}` : "Author unknown";
  const site = String(siteName || siteDomain || "").trim();

  return (
    <View style={styles.wrap} accessibilityRole="text">
      <Text style={styles.by}>{by}</Text>
      {site ? (
        sourceUrl ? (
          <Pressable
            onPress={() => Linking.openURL(sourceUrl)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${site}`}
          >
            <Text style={styles.site}>{site}</Text>
          </Pressable>
        ) : (
          <Text style={styles.siteMuted}>{site}</Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[1],
    marginBottom: space[4],
  },
  by: {
    fontFamily: fonts.essay,
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkSoft,
    letterSpacing: -0.2,
  },
  site: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.forest,
    textDecorationLine: "underline",
  },
  siteMuted: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
});
