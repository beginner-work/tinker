import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, space } from "@/src/theme/tokens";

type Props = {
  text: string;
  /** Absolute word index within the full text (approx via chunk offset). */
  activeWordIndex: number;
  /** Word index of the first word in `text`. */
  chunkStartWordIndex?: number;
};

/**
 * Word-tracking cursor: past words fade, the current word gets a soft leaf
 * highlight — the reading feel from the web widget, made visible on mobile.
 */
export function WordCursor({
  text,
  activeWordIndex,
  chunkStartWordIndex = 0,
}: Props) {
  const words = useMemo(() => {
    const raw = String(text || "").trim();
    if (!raw) return [] as string[];
    return raw.split(/\s+/);
  }, [text]);

  if (!words.length) {
    return (
      <Text style={styles.placeholder}>
        Press Listen — words track here as Tinker reads the expert text aloud.
      </Text>
    );
  }

  const localActive = Math.max(0, activeWordIndex - chunkStartWordIndex);

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <Text style={styles.prose}>
        {words.map((word, i) => {
          const isPast = i < localActive;
          const isCurrent = i === localActive;
          return (
            <Text
              key={`${i}-${word.slice(0, 8)}`}
              style={[
                styles.word,
                isPast && styles.past,
                isCurrent && styles.current,
                !isPast && !isCurrent && styles.ahead,
              ]}
            >
              {word}
              {i < words.length - 1 ? " " : ""}
            </Text>
          );
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 120,
  },
  prose: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 30,
    color: colors.ink,
  },
  word: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 30,
  },
  past: {
    color: colors.wordPast,
  },
  current: {
    color: colors.wordCurrent,
    fontFamily: fonts.bodySemi,
    backgroundColor: colors.wordCurrentBg,
  },
  ahead: {
    color: colors.wordAhead,
  },
  placeholder: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
  },
});
