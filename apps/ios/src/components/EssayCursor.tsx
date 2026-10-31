import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts, space } from "@/src/theme/tokens";
import { punchyLines } from "@/src/api/reading";

type Props = {
  text: string;
  activeWordIndex: number;
  /** When false, do not auto-follow (paused). */
  followActive?: boolean;
};

/**
 * Lindowlabs-style essay column: Fraunces ~17.64px / ~10 words per line,
 * rainbow underline under the current spoken word (ll-talk-essay__cursor-line).
 */
export function EssayCursor({ text, activeWordIndex, followActive = true }: Props) {
  const { tokens, lineBreakAfter } = useMemo(() => {
    const lines = punchyLines(text);
    const toks: string[] = [];
    const breaks = new Set<number>();
    for (const line of lines) {
      const words = line.split(/\s+/).filter(Boolean);
      for (const w of words) toks.push(w);
      if (toks.length) breaks.add(toks.length - 1);
    }
    return { tokens: toks, lineBreakAfter: breaks };
  }, [text]);

  if (!tokens.length) {
    return (
      <Text style={styles.placeholder}>
        Press play — Tinker reads the expert text aloud, word by word.
      </Text>
    );
  }

  const active = Math.max(0, Math.min(activeWordIndex, tokens.length - 1));

  return (
    <View style={styles.column} accessibilityLiveRegion={followActive ? "polite" : "none"}>
      <Text style={styles.prose}>
        {tokens.map((word, i) => {
          const isPast = i < active;
          const isCurrent = i === active;
          const br = lineBreakAfter.has(i);
          return (
            <Text key={`${i}-${word.slice(0, 12)}`}>
              <Text
                style={[
                  styles.word,
                  isPast && styles.past,
                  isCurrent && styles.current,
                  !isPast && !isCurrent && styles.ahead,
                ]}
              >
                {word}
              </Text>
              {isCurrent ? (
                <Text style={styles.underlineWrap}>
                  {"\n"}
                  <View style={styles.underlineSlot}>
                    <LinearGradient
                      colors={[
                        colors.logoPink,
                        colors.logoOrange,
                        colors.logoYellow,
                        colors.logoLeaf,
                        colors.logoSky,
                        colors.logoPurple,
                        colors.logoMint,
                      ]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.underline, { width: Math.max(28, word.length * 8) }]}
                    />
                  </View>
                  {"\n"}
                </Text>
              ) : (
                <Text>{br ? "\n\n" : " "}</Text>
              )}
            </Text>
          );
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: space[5],
  },
  prose: {
    fontFamily: fonts.essay,
    fontSize: 17.64,
    lineHeight: 30,
    color: colors.ink,
    letterSpacing: -0.15,
  },
  word: {
    fontFamily: fonts.essay,
    fontSize: 17.64,
    lineHeight: 30,
  },
  past: {
    color: colors.wordPast,
  },
  current: {
    fontFamily: fonts.essaySemi,
    color: colors.ink,
  },
  ahead: {
    color: colors.wordAhead,
  },
  underlineWrap: {
    fontSize: 4,
    lineHeight: 8,
  },
  underlineSlot: {
    height: 4,
    marginTop: 2,
    marginBottom: 6,
  },
  underline: {
    height: 3,
    borderRadius: 999,
  },
  placeholder: {
    fontFamily: fonts.essay,
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
    paddingHorizontal: space[5],
  },
});
