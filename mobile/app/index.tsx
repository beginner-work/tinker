import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { AppChrome } from "../src/components/AppChrome";
import {
  LocationPicker,
  PlaceId,
  seedFromPlace,
} from "../src/components/LocationPicker";
import { useAuth } from "../src/auth/AuthContext";
import {
  Draft,
  Essay,
  essayId,
  getDrafts,
  mergeById,
  putDrafts,
} from "../src/api/userData";
import {
  askNext,
  firstSentence,
  openingQuestion,
  slugify,
} from "../src/lib/interview";
import { createDraft, publishEssayWithPullRequest } from "../src/lib/drafts";
import { isGitHubConnected } from "../src/lib/github";
import { colors, fonts, radius, type } from "../src/theme";
import type { WritingMode } from "../src/components/ModeNav";

/**
 * Home = writing surface. Location is a top dropdown — no welcome framing.
 */
export default function WritingHome() {
  const { signedIn } = useAuth();
  const [mode, setMode] = useState<WritingMode>("ai");
  const [placeId, setPlaceId] = useState<PlaceId>("cafe");
  const [customSeed, setCustomSeed] = useState("");
  const seed = seedFromPlace(placeId, customSeed);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [question, setQuestion] = useState("What are you learning?");
  const [answer, setAnswer] = useState("");
  const [freeBody, setFreeBody] = useState("");
  const [phase, setPhase] = useState<"idle" | "asking" | "thinking">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  const ensureReady = useCallback(async (): Promise<boolean> => {
    if (!signedIn) {
      router.push("/sign-in");
      return false;
    }
    const connected = await isGitHubConnected();
    if (!connected) {
      router.push({
        pathname: "/connect-repo",
        params: { next: "write", seed, mode },
      });
      return false;
    }
    return true;
  }, [signedIn, seed, mode]);

  // Boot / location change: open a fresh draft when the transcript is empty.
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (signedIn === false || signedIn === null) {
        setDraft(null);
        setQuestion("What are you learning?");
        setPhase("idle");
        return;
      }
      const d = draftRef.current;
      if (d && (d.transcript || []).length > 0) {
        // Mid-interview — keep the draft; only refresh seed label.
        if (d.seed !== seed) {
          const next = { ...d, seed };
          setDraft(next);
          persist(next);
        }
        return;
      }
      setPhase("thinking");
      setError(null);
      try {
        const created = await createDraft(seed);
        if (!mounted) return;
        setDraft(created);
        const q = await openingQuestion(seed, null);
        if (!mounted) return;
        setQuestion(q || "What are you learning?");
        setPhase("asking");
        await persist({ ...created, pending: q || "What are you learning?" });
      } catch {
        if (!mounted) return;
        setQuestion("What are you learning?");
        setPhase("asking");
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, seed]);

  async function persist(next: Draft) {
    next.updatedAt = Date.now();
    setDraft(next);
    try {
      const server = await getDrafts();
      await putDrafts(mergeById([next], server));
    } catch {
      // Offline — keep in memory
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
      const next = {
        ...d,
        pending: result.question,
        currentStep: d.transcript.length,
      };
      setQuestion(result.question);
      setPhase("asking");
      await persist(next);
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
      setPhase("asking");
    }
  }

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
      seed: d.seed || seed || null,
    };
    const { essay: saved, prError } = await publishEssayWithPullRequest(
      essay,
      d.id,
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    setDraft(null);
    setAnswer("");
    setFreeBody("");
    setPhase("idle");
    router.push({
      pathname: "/assessing",
      params: {
        id: saved.id,
        prUrl: saved.github?.prUrl || "",
        prError: prError || "",
      },
    });
  }

  async function submitAnswer(opts: { done: boolean }) {
    if (!(await ensureReady())) return;
    let d = draftRef.current;
    if (!d) {
      d = await createDraft(seed);
      setDraft(d);
    }
    if (phase === "thinking") return;
    const a = answer.trim();
    if (!a && !opts.done) return;
    const next: Draft = {
      ...d,
      seed,
      transcript: [...(d.transcript || [])],
      pending: null,
    };
    if (a) {
      next.transcript.push({ q: question, a });
      if (next.transcript.length === 1) {
        next.title = firstSentence(a) || next.title;
      }
    }
    if (next.transcript.length === 0) return;
    next.currentStep = next.transcript.length;
    setAnswer("");
    await persist(next);
    await advance(next, { forceStitch: opts.done });
  }

  async function submitFreewrite() {
    if (!(await ensureReady())) return;
    const text = freeBody.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const title = firstSentence(text) || "Untitled";
      const id = essayId();
      const slug = slugify(title) + "-" + id.slice(2, 6);
      const essay: Essay = {
        id,
        slug,
        author: "you",
        title,
        body: text,
        createdAt: Date.now(),
        url: `/you/${slug}`,
        sourceDraft: "freewrite",
        kind: "essay",
        seed,
      };
      const { essay: saved, prError } = await publishEssayWithPullRequest(essay);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      setFreeBody("");
      router.push({
        pathname: "/assessing",
        params: {
          id: saved.id,
          prUrl: saved.github?.prUrl || "",
          prError: prError || "",
        },
      });
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function onChangePlace(id: PlaceId) {
    setPlaceId(id);
    // Fresh location → fresh draft (unless mid-transcript).
    const d = draftRef.current;
    if (d && (d.transcript || []).length > 0) return;
    setDraft(null);
    setAnswer("");
  }

  const answered = draft?.transcript?.length || 0;
  const showThinking = mode === "ai" && phase === "thinking";

  return (
    <AppChrome mode={mode} onModeChange={setMode}>
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.topBar}>
            <View style={styles.topSpacer} />
            <LocationPicker
              placeId={placeId}
              customSeed={customSeed}
              onChangePlace={onChangePlace}
              onChangeCustomSeed={setCustomSeed}
            />
            <View style={styles.dots}>
              {mode === "ai"
                ? Array.from({ length: Math.max(answered + 1, 5) }, (_, i) => (
                    <View
                      key={i}
                      style={[styles.dot, i < answered && styles.dotDone]}
                    />
                  ))
                : null}
            </View>
          </View>

          {showThinking ? (
            <View style={styles.center}>
              <Text style={styles.thinking}>
                {error
                  ? "Something went wrong."
                  : "Thinking through what to ask next…"}
              </Text>
              {error ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    pressed && styles.buttonPressed,
                    { marginTop: 16, minWidth: 140 },
                  ]}
                  onPress={() => {
                    const d = draftRef.current;
                    if (!d) return;
                    setError(null);
                    advance(d, { forceStitch: false });
                  }}
                >
                  <Text style={styles.buttonText}>Try again</Text>
                </Pressable>
              ) : null}
            </View>
          ) : mode === "noai" ? (
            <View style={styles.card}>
              <Text style={styles.question}>What are you learning?</Text>
              <TextInput
                style={styles.answer}
                value={freeBody}
                onChangeText={setFreeBody}
                placeholder="Type your answer in your own words…"
                placeholderTextColor={colors.muted}
                multiline
                textAlignVertical="top"
                autoFocus
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                  (!freeBody.trim() || busy) && styles.buttonDisabled,
                ]}
                onPress={submitFreewrite}
                disabled={!freeBody.trim() || busy}
              >
                <Text style={styles.buttonText}>
                  {busy ? "…" : "This is everything →"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.question}>{question}</Text>
              <TextInput
                style={styles.answer}
                value={answer}
                onChangeText={setAnswer}
                placeholder="Type your answer in your own words…"
                placeholderTextColor={colors.muted}
                multiline
                textAlignVertical="top"
                autoFocus
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => submitAnswer({ done: false })}
                >
                  <Text style={styles.buttonText}>Next →</Text>
                </Pressable>
              </View>
              {answered > 0 || answer.trim() ? (
                <Pressable onPress={() => submitAnswer({ done: true })}>
                  <Text style={styles.endNow}>This is everything →</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 64,
    paddingRight: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  topSpacer: { width: 0 },
  dots: { flexDirection: "row", gap: 6, marginLeft: "auto" },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotDone: { backgroundColor: colors.leaf },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  thinking: {
    fontFamily: fonts.sans,
    fontSize: type.base,
    color: colors.muted,
  },
  card: { flex: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 88 },
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
  button: {
    flex: 1,
    backgroundColor: colors.accentStrong,
    borderRadius: radius.button,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: { backgroundColor: colors.accentPress },
  buttonDisabled: { opacity: 0.45 },
  buttonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.surface,
  },
  endNow: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
    textAlign: "center",
    paddingVertical: 10,
    marginBottom: 8,
  },
});
