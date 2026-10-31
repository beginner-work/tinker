import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { EssayCursor } from "@/src/components/EssayCursor";
import { SourceByline } from "@/src/components/SourceByline";
import { SiteHeader } from "@/src/components/SiteHeader";
import { TalkPlayerBar } from "@/src/components/TalkPlayerBar";
import { AskPanel } from "@/src/components/AskPanel";
import { useReadingSession } from "@/src/hooks/useReadingSession";
import { colors, fonts, space } from "@/src/theme/tokens";

export default function ReadScreen() {
  const params = useLocalSearchParams<{
    url: string;
    title?: string;
    author?: string;
    authorSource?: string;
    authorUnknown?: string;
    siteName?: string;
  }>();
  const reader = useReadingSession();
  const [askOpen, setAskOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    const u = String(params.url || "").trim();
    if (!u) {
      router.replace("/");
      return;
    }
    void reader
      .startSession(u, {
        title: String(params.title || ""),
        author: String(params.author || ""),
        authorSource: String(params.authorSource || ""),
        authorUnknown: params.authorUnknown === "1",
        siteName: String(params.siteName || ""),
      })
      .catch(() => {
        /* statusMessage set in hook */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.url]);

  const isReading = reader.status === "reading";
  const canControl = Boolean(reader.session) && reader.status !== "loading";
  const title = reader.session?.title || String(params.title || "") || "Reading";
  const authorUnknown =
    reader.session?.authorUnknown === true ||
    (!reader.session?.author && params.authorUnknown === "1") ||
    (reader.session != null && !String(reader.session.author || "").trim());

  return (
    <View style={styles.root}>
      <SiteHeader onBrandPress={() => router.replace("/")} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          <Pressable
            onPress={() => setShowInfo((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="About this reading"
            style={styles.infoBtn}
          >
            <Text style={styles.infoGlyph}>i</Text>
          </Pressable>
        </View>

        {showInfo ? (
          <Text style={styles.infoTip}>
            Verbatim from the source page — not rewritten by the model.
          </Text>
        ) : null}

        <SourceByline
          author={reader.session?.author || String(params.author || "")}
          authorUnknown={authorUnknown}
          siteName={reader.session?.siteName || String(params.siteName || "")}
          siteDomain={reader.siteDomain}
          sourceUrl={reader.session?.sourceUrl}
        />

        {reader.status === "loading" ? (
          <Text style={styles.status}>{reader.statusMessage || "Loading…"}</Text>
        ) : reader.status === "error" ? (
          <Text style={[styles.status, styles.statusError]}>
            {reader.statusMessage || "Something went wrong."}
          </Text>
        ) : (
          <EssayCursor
            text={reader.essayText || reader.chunkText}
            activeWordIndex={reader.wordIndex}
            followActive={isReading}
          />
        )}

        {reader.answer?.answerText ? (
          <View style={styles.answer}>
            <Text style={styles.answerLabel}>Answer</Text>
            <Text style={styles.answerText}>{reader.answer.answerText}</Text>
          </View>
        ) : null}

        <View style={{ height: 120 }} />
      </ScrollView>

      <TalkPlayerBar
        isPlaying={isReading}
        disabled={!canControl}
        progress={reader.progress}
        onPlayPause={() => {
          setAskOpen(false);
          if (isReading) reader.pause();
          else reader.resume();
        }}
        onAsk={() => {
          reader.pause();
          setAskOpen(true);
        }}
      />

      <AskPanel
        visible={askOpen}
        busy={reader.status === "asking"}
        onClose={() => setAskOpen(false)}
        onSubmit={(q, input, raw) => {
          void reader.ask(q, input, raw).then(() => setAskOpen(false));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: space[8],
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 31,
    lineHeight: 36,
    color: colors.ink,
    letterSpacing: -0.93,
    fontWeight: "600",
  },
  infoBtn: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  infoGlyph: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.muted,
  },
  infoTip: {
    fontFamily: fonts.essay,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.muted,
    marginBottom: 10,
  },
  status: {
    fontFamily: fonts.essay,
    fontSize: 15,
    color: colors.muted,
  },
  statusError: { color: colors.error },
  answer: {
    marginTop: space[6],
    paddingTop: space[4],
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: space[2],
  },
  answerLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.muted,
  },
  answerText: {
    fontFamily: fonts.essay,
    fontSize: 16,
    lineHeight: 26,
    color: colors.ink,
  },
});
