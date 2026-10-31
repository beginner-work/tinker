import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts } from "@/src/theme/tokens";

type Props = {
  text: string;
  activeWordIndex: number;
  followActive?: boolean;
};

type Para = { words: string[]; startIndex: number };

function paragraphsFromText(text: string): Para[] {
  const paras = String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out: Para[] = [];
  let idx = 0;
  for (const p of paras.length ? paras : [String(text || "").trim()].filter(Boolean)) {
    const words = p.split(/\s+/).filter(Boolean);
    out.push({ words, startIndex: idx });
    idx += words.length;
  }
  return out;
}

/**
 * Flowing prose like lindowlabs `.ll-talk-essay__p`: Fraunces 17.64 / ~30 line
 * height, paragraph spacing ~1.35em. Rainbow underline sits inline under the
 * current word (absolute within the token) — never forces a line break.
 */
export function EssayCursor({ text, activeWordIndex, followActive = true }: Props) {
  const paragraphs = useMemo(() => paragraphsFromText(text), [text]);
  const totalWords = paragraphs.reduce((n, p) => n + p.words.length, 0);

  if (!totalWords) {
    return (
      <Text style={styles.placeholder}>
        Press play — Tinker reads the expert text aloud, word by word.
      </Text>
    );
  }

  const active = Math.max(0, Math.min(activeWordIndex, totalWords - 1));

  return (
    <View
      style={styles.column}
      accessibilityLiveRegion={followActive ? "polite" : "none"}
    >
      {paragraphs.map((para, pi) => (
        <View key={`p-${pi}`} style={styles.paragraph}>
          {para.words.map((word, wi) => {
            const global = para.startIndex + wi;
            const isPast = global < active;
            const isCurrent = global === active;
            return (
              <View key={`${global}-${word.slice(0, 8)}`} style={styles.token}>
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
                    style={styles.underline}
                    pointerEvents="none"
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: "100%",
  },
  paragraph: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    marginBottom: 24, // ~1.35em at 17.64
    columnGap: 0,
  },
  token: {
    position: "relative",
    paddingBottom: 3,
    marginRight: 5.5,
    marginBottom: 2,
  },
  word: {
    fontFamily: fonts.essay,
    fontSize: 17.64,
    lineHeight: 30,
    letterSpacing: -0.176,
    color: colors.ink,
  },
  past: {
    color: colors.wordPast,
  },
  current: {
    color: colors.ink,
    backgroundColor: "rgba(45, 42, 38, 0.06)",
  },
  ahead: {
    color: colors.wordAhead,
  },
  underline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    borderRadius: 999,
  },
  placeholder: {
    fontFamily: fonts.essay,
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
  },
});
