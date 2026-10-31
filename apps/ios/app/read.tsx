import { useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { BrandMark } from "@/src/components/BrandMark";
import { WordCursor } from "@/src/components/WordCursor";
import { AskPanel } from "@/src/components/AskPanel";
import { useReadingSession } from "@/src/hooks/useReadingSession";
import { colors, fonts, space } from "@/src/theme/tokens";

export default function ReadScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const reader = useReadingSession();
  const [askOpen, setAskOpen] = useState(false);

  useEffect(() => {
    const u = String(url || "").trim();
    if (!u) {
      router.replace("/");
      return;
    }
    void reader.startSession(u).catch(() => {
      /* statusMessage set in hook */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const isReading = reader.status === "reading";
  const canControl = Boolean(reader.session) && reader.status !== "loading";

  return (
    <LinearGradient colors={[colors.bg0, colors.bg1]} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <BrandMark size="compact" />
        </View>

        <View style={styles.card}>
          <Text style={styles.meta} numberOfLines={3}>
            {reader.session?.title
              ? [
                  reader.session.title,
                  reader.session.author ? `by ${reader.session.author}` : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              : "Loading text…"}
            {reader.siteDomain ? ` · ${reader.siteDomain}` : ""}
          </Text>
          {reader.session?.sourceUrl ? (
            <Pressable
              onPress={() => Linking.openURL(reader.session!.sourceUrl)}
              accessibilityRole="link"
            >
              <Text style={styles.sourceLink}>Open original</Text>
            </Pressable>
          ) : null}

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${reader.progress * 100}%` }]} />
          </View>

          <Text
            style={[
              styles.status,
              reader.status === "error" && styles.statusError,
              (reader.status === "reading" || reader.status === "asking") && styles.statusBusy,
            ]}
          >
            {reader.statusMessage || " "}
          </Text>

          <WordCursor
            text={reader.chunkText}
            activeWordIndex={reader.wordIndex}
            chunkStartWordIndex={reader.chunkStart}
          />

          <View style={styles.controls}>
            {isReading ? (
              <Pressable
                style={[styles.btn, styles.ghost]}
                onPress={reader.pause}
                disabled={!canControl}
                accessibilityRole="button"
              >
                <Text style={styles.ghostText}>Pause</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.btn, styles.primary]}
                onPress={() => {
                  setAskOpen(false);
                  reader.resume();
                }}
                disabled={!canControl || reader.status === "asking"}
                accessibilityRole="button"
                accessibilityLabel="Listen"
              >
                <Text style={styles.primaryText}>
                  {reader.status === "ready" || reader.status === "paused" || reader.status === "answering"
                    ? "Listen"
                    : reader.status === "done"
                      ? "Listen again"
                      : "Listen"}
                </Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.btn, styles.ghost]}
              onPress={() => {
                reader.pause();
                setAskOpen(true);
              }}
              disabled={!canControl}
              accessibilityRole="button"
              accessibilityLabel="Ask a question"
            >
              <Text style={styles.ghostText}>Ask</Text>
            </Pressable>
          </View>

          <AskPanel
            visible={askOpen}
            busy={reader.status === "asking"}
            onClose={() => setAskOpen(false)}
            onSubmit={(q, input, raw) => {
              void reader.ask(q, input, raw).then(() => setAskOpen(false));
            }}
          />

          {reader.answer?.answerText ? (
            <View style={styles.answer}>
              <Text style={styles.answerLabel}>Answer</Text>
              <Text style={styles.answerText}>{reader.answer.answerText}</Text>
              {reader.answer.fetchedSource && reader.answer.fetchedSourceUrl ? (
                <Pressable
                  onPress={() => Linking.openURL(reader.answer!.fetchedSourceUrl!)}
                >
                  <Text style={styles.sourceLink}>Linked source</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: space[5],
    paddingTop: space[7],
    paddingBottom: space[8],
    gap: space[4],
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  back: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.accent,
    marginTop: space[5],
  },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    padding: space[5],
    gap: space[4],
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  sourceLink: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.accent,
    textDecorationLine: "underline",
  },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(28, 36, 31, 0.08)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent,
  },
  status: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    minHeight: 18,
  },
  statusBusy: { color: colors.accent },
  statusError: { color: colors.error },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  btn: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  primary: { backgroundColor: colors.accent },
  primaryText: {
    fontFamily: fonts.bodySemi,
    color: "#f7fff9",
    fontSize: 15,
  },
  ghost: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "transparent",
  },
  ghostText: {
    fontFamily: fonts.bodySemi,
    color: colors.ink,
    fontSize: 15,
  },
  answer: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    padding: space[4],
    gap: space[2],
  },
  answerLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.muted,
  },
  answerText: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
});
