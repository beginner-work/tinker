/**
 * Prose — a tiny Markdown renderer sized to what tinker's essays actually
 * use: blank-line-separated paragraphs with inline **bold**, `code`, and
 * [label](url) links. Deliberately not a full Markdown engine — the search
 * prompt promises "no headings, no bulleted lists — just flowing prose."
 * Links open in the system browser.
 */

import { Fragment } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { colors, fonts, leading, space, type } from "../theme";

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyBase: string) {
  const parts = text.split(INLINE).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={key} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text key={key} style={styles.code}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const [, label, url] = link;
      return (
        <Text
          key={key}
          style={styles.link}
          onPress={() => Linking.openURL(url).catch(() => {})}
          accessibilityRole="link"
        >
          {label}
        </Text>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}|\n/).filter((p) => p.trim().length > 0);
  return (
    <View>
      {paragraphs.map((p, i) => (
        <Text key={i} style={styles.paragraph}>
          {renderInline(p, String(i))}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  paragraph: {
    fontFamily: fonts.sans,
    fontSize: type.essay,
    lineHeight: type.essay * leading.prose,
    color: colors.foreground,
    marginBottom: space[5],
  },
  bold: { fontFamily: fonts.sansSemi },
  code: {
    fontFamily: "monospace",
    fontSize: type.body,
    color: colors.accentStrong,
  },
  link: {
    fontFamily: fonts.sansMedium,
    color: colors.accentStrong,
    textDecorationLine: "underline",
  },
});
