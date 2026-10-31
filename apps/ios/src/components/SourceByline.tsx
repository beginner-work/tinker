import { Linking, StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "@/src/theme/tokens";

type Props = {
  author?: string;
  authorUnknown?: boolean;
  siteName?: string;
  siteDomain?: string;
  sourceUrl?: string;
};

/**
 * Subtitle-style attribution under the title — matches lindowlabs
 * `.ll-talk-essay__audio-note` (Fraunces ~13.44 / muted).
 * Shows "By <Author>" + linked site. Never invents an author.
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
      <Text style={styles.note}>
        {by}
        {site ? " · " : ""}
        {site ? (
          sourceUrl ? (
            <Text
              style={styles.site}
              onPress={() => Linking.openURL(sourceUrl)}
              accessibilityRole="link"
            >
              {site}
            </Text>
          ) : (
            <Text style={styles.siteMuted}>{site}</Text>
          )
        ) : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 18,
  },
  note: {
    fontFamily: fonts.essay,
    fontSize: 13.44,
    lineHeight: 19.5,
    letterSpacing: -0.13,
    color: colors.muted,
  },
  site: {
    fontFamily: fonts.essay,
    fontSize: 13.44,
    lineHeight: 19.5,
    color: colors.forest,
    textDecorationLine: "underline",
  },
  siteMuted: {
    fontFamily: fonts.essay,
    fontSize: 13.44,
    lineHeight: 19.5,
    color: colors.muted,
  },
});
