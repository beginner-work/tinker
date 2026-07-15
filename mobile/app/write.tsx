import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "../src/auth/AuthContext";
import {
  Draft,
  Essay,
  essayId,
  getDrafts,
  getEssays,
  mergeById,
  putDrafts,
  putEssays,
} from "../src/api/userData";
import { askNext, firstSentence, openingQuestion, slugify } from "../src/lib/interview";
import { useDictation } from "../src/lib/useDictation";
import { colors, fonts, radius, type } from "../src/theme";

/* The writing surface: one question at a time, a large answer box, a
 * mic. Same interview engine as the web renderer; the founder's words
 * are the only words that end up in the essay. */
export default function Write() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signedIn } = useAuth();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [question, setQuestion] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<"loading" | "asking" | "thinking" | "published">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ title: string; body: string } | null>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  const dictation = useDictation((finalText) => {
    setAnswer((prev) => (prev ? `${prev.trimEnd()} ${finalText}` : finalText));
  });

  useEffect(() => {
    if (signedIn === false) router.replace("/sign-in");
  }, [signedIn]);

  // Load the draft and surface its next question.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const all = await getDrafts();
        const d = all.find((x) => x.id === id);
        if (!mounted) return;
        if (!d) {
          setError("That draft isn't here anymore.");
          return;
        }
        setDraft(d);
        if (d.pending) {
          setQuestion(d.pending);
          setPhase("asking");
        } else if ((d.transcript || []).length === 0) {
          const q = await openingQuestion(d.seed, d.facing);
          if (!mounted) return;
          setQuestion(q);
          setPhase("asking");
          persist({ ...d, pending: q });
        } else {
          setPhase("thinking");
          await advance(d, { forceStitch: false });
        }
      } catch (e: any) {
        if (mounted) setError(e?.message || "Couldn't open the draft.");
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function persist(next: Draft) {
    next.updatedAt = Date.now();
    setDraft(next);
    try {
      const server = await getDrafts();
      await putDrafts(mergeById([next], server));
    } catch {
      // Offline: the draft lives in memory for this session; the next
      // successful persist carries it up.
    }
  }

  async function advance(d: Draft, { forceStitch }: { forceStitch: boolean }) {
    setPhase("thinking");
    setError(null);
    try {
      const result = await askNext(d, { forceStitch });
      if (result.kind === "stitched") {
        await publish(d, result.title, result.body);
        return;
      }
      const next = { ...d, pending: result.question, currentStep: d.transcript.length };
      setQuestion(result.question);
      setPhase("asking");
      await persist(next);
    } catch (e: any) {
      setError(e?.message || "Something broke mid-question — try again.");
      setPhase("asking");
    }
  }

  /* Publish straight through, like the web: essay into the essays blob,
   * draft removed. No review step — the founder wrote every word. */
  async function publish(d: Draft, title: string, body: string) {
    const slug = slugify(title || "untitled") + "-" + d.id.slice(2, 6);
    const essay: Essay = {
      id: essayId(),
      slug,
      author: "you",
      title: title || "Untitled",
      body,
      createdAt: Date.now(),
      url: `/you/${slug}`,
      sourceDraft: d.id,
      kind: "essay",
      seed: d.seed || null,
    };
    const [essays, serverDrafts] = await Promise.all([
      getEssays().catch(() => [] as Essay[]),
      getDrafts().catch(() => [] as Draft[]),
    ]);
    await putEssays([essay, ...essays]);
    await putDrafts(serverDrafts.filter((x) => x.id !== d.id));
    setPublished({ title: essay.title, body: essay.body });
    setPhase("published");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  function submitAnswer(opts: { done: boolean }) {
    const d = draftRef.current;
    if (!d || phase !== "asking") return;
    if (dictation.listening) dictation.stop();
    const a = answer.trim();
    if (!a && !opts.done) return;
    const next: Draft = { ...d, transcript: [...(d.transcript || [])], pending: null };
    if (a) {
      next.transcript.push({ q: question, a });
      if (next.transcript.length === 1) next.title = firstSentence(a) || next.title;
    }
    if (next.transcript.length === 0) return; // nothing to stitch from
    next.currentStep = next.transcript.length;
    setAnswer("");
    persist(next);
    advance(next, { forceStitch: opts.done });
  }

  function toggleMic() {
    Haptics.selectionAsync().catch(() => {});
    if (dictation.listening) dictation.stop();
    else dictation.start();
  }

  const answered = draft?.transcript?.length || 0;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.topAction}>Close</Text>
          </Pressable>
          <View style={styles.dots}>
            {Array.from({ length: Math.max(answered + 1, 5) }, (_, i) => (
              <View
                key={i}
                style={[styles.dot, i < answered && styles.dotDone]}
              />
            ))}
          </View>
        </View>

        {phase === "loading" ? (
          <View style={styles.center}>
            <Text style={styles.thinking}>Opening…</Text>
          </View>
        ) : phase === "published" && published ? (
          <ScrollView style={styles.readWrap} contentContainerStyle={{ paddingBottom: 40 }}>
            <Text style={styles.readTitle}>{published.title}</Text>
            <Text style={styles.readBody}>{published.body}</Text>
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={() => router.replace("/home")}
            >
              <Text style={styles.buttonText}>Done</Text>
            </Pressable>
          </ScrollView>
        ) : phase === "thinking" ? (
          <View style={styles.center}>
            <Text style={styles.thinking}>Thinking through what to ask next…</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.question}>{question}</Text>
            <TextInput
              style={styles.answer}
              value={dictation.partial ? `${answer} ${dictation.partial}`.trim() : answer}
              onChangeText={setAnswer}
              placeholder={
                dictation.listening ? "Listening…" : "Type, or tap the mic and talk."
              }
              placeholderTextColor={colors.muted}
              multiline
              editable={!dictation.listening}
              textAlignVertical="top"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {dictation.error ? <Text style={styles.error}>{dictation.error}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [
                  styles.mic,
                  dictation.listening && styles.micLive,
                  pressed && styles.buttonPressed,
                ]}
                onPress={toggleMic}
              >
                <Text style={styles.micText}>
                  {dictation.listening ? "■ Stop" : "● Speak"}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                onPress={() => submitAnswer({ done: false })}
              >
                <Text style={styles.buttonText}>Next</Text>
              </Pressable>
            </View>
            {answered > 0 || answer.trim() ? (
              <Pressable onPress={() => submitAnswer({ done: true })}>
                <Text style={styles.endNow}>This is everything</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topAction: { fontFamily: fonts.sans, fontSize: type.body, color: colors.muted },
  dots: { flexDirection: "row", gap: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotDone: { backgroundColor: colors.leaf },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  thinking: { fontFamily: fonts.sans, fontSize: type.base, color: colors.muted },
  card: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  question: {
    fontFamily: fonts.display,
    fontSize: type.displayLg - 6,
    lineHeight: (type.displayLg - 6) * 1.15,
    color: colors.foreground,
    marginBottom: 20,
  },
  answer: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: type.essay,
    lineHeight: type.essay * 1.55,
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 12,
  },
  error: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.foreground,
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.chip,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  actions: { flexDirection: "row", gap: 10, marginBottom: 10 },
  mic: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    paddingVertical: 14,
    alignItems: "center",
  },
  micLive: { backgroundColor: colors.errorBg, borderColor: colors.errorBorder },
  micText: { fontFamily: fonts.sansSemiBold, fontSize: type.base, color: colors.foreground },
  button: {
    flex: 1,
    backgroundColor: colors.accentStrong,
    borderRadius: radius.button,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: { backgroundColor: colors.accentPress },
  buttonText: { fontFamily: fonts.sansSemiBold, fontSize: type.base, color: colors.surface },
  endNow: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
    textAlign: "center",
    paddingVertical: 10,
    marginBottom: 8,
  },
  readWrap: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  readTitle: {
    fontFamily: fonts.display,
    fontSize: type.displayLg - 6,
    lineHeight: (type.displayLg - 6) * 1.15,
    color: colors.foreground,
    marginBottom: 16,
  },
  readBody: {
    fontFamily: fonts.sans,
    fontSize: type.essay,
    lineHeight: type.essay * 1.7,
    color: colors.foreground,
    marginBottom: 28,
  },
});
