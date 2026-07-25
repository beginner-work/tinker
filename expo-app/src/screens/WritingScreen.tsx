/**
 * WritingScreen — the guided interview, ported from #writing / writing.js.
 * Onboarding-shaped: one question at a time, a large input, progress dots.
 * It is NOT a chat. The interviewer only asks; the founder answers in their
 * own words; the essay at the end is stitched from those typed answers ONLY
 * (RULE 1 + RULE 2 in the web app's system prompt) — no invented prose.
 *
 * In the full app the follow-up questions come from Claude, phrased in the
 * founder's own voice and steered by the seed. Here — with no live Stytch
 * session in preview — we walk a fixed set of learning-focused questions
 * that honour the same rules (every question pursues what the founder is
 * learning) so the flow is fully playable end-to-end.
 */

import { useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassSurface } from "../components/GlassSurface";
import { GlassButton } from "../components/GlassButton";
import { Prose } from "../components/Prose";
import { colors, fonts, leading, radius, space, type } from "../theme";

const QUESTIONS = [
  "What are you learning?",
  "What's becoming clearer that wasn't before?",
  "What are you noticing now that you didn't expect?",
  "What idea is clicking — or breaking — as you work through this?",
  "What are you figuring out about how you want to build?",
  "What's one thing you're coming to understand that you'd tell yourself a month ago?",
];

type Props = {
  seed: string;
  onExit: () => void;
};

export function WritingScreen({ seed, onExit }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [essay, setEssay] = useState<{ title: string; body: string } | null>(null);
  const inputRef = useRef<TextInput>(null);

  const total = QUESTIONS.length;
  const canAdvance = draft.trim().length > 0;
  const canEnd = answers.length > 0 || draft.trim().length > 0;

  const collected = useMemo(() => {
    const all = [...answers];
    if (draft.trim()) all.push(draft.trim());
    return all.filter(Boolean);
  }, [answers, draft]);

  function stitch() {
    // RULE 2 — stitch, do not author. Join the founder's typed answers with
    // paragraph breaks; nothing added, nothing paraphrased.
    const body = collected.join("\n\n");
    // RULE 3 — title from their words: the first short, contiguous phrase.
    const first = collected[0] ?? seed;
    const title =
      first.split(/[.!?\n]/)[0].trim().slice(0, 60) || seed;
    setEssay({ title, body });
  }

  function next() {
    if (!canAdvance) return;
    const nextAnswers = [...answers, draft.trim()];
    setAnswers(nextAnswers);
    setDraft("");
    if (step + 1 >= total) {
      // Ran out of scripted questions — stitch what we have.
      const body = nextAnswers.filter(Boolean).join("\n\n");
      const first = nextAnswers[0] ?? seed;
      setEssay({
        title: first.split(/[.!?\n]/)[0].trim().slice(0, 60) || seed,
        body,
      });
      return;
    }
    setStep(step + 1);
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  function end() {
    if (!canEnd) return;
    stitch();
  }

  if (essay) {
    return (
      <View style={styles.root}>
        <ScrollView
          contentContainerStyle={[
            styles.readContent,
            { paddingTop: insets.top + space[7], paddingBottom: insets.bottom + space[8] },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={onExit} style={styles.closeRow} activeOpacity={0.7}>
            <Text style={styles.closeText}>✕ Done</Text>
          </TouchableOpacity>
          <Text style={styles.seedCrumb}>{seed}</Text>
          <Text style={styles.essayTitle}>{essay.title}</Text>
          <Prose text={essay.body} />
          <GlassSurface radius={radius.chip} tint="accent" style={styles.stitchNote}>
            <Text style={styles.stitchNoteText}>
              Stitched from your words only — nothing added. In the full app
              this publishes straight to your pitch.
            </Text>
          </GlassSurface>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.top, { paddingTop: insets.top + space[3] }]}>
          <TouchableOpacity
            onPress={onExit}
            accessibilityLabel="Close — return to feed"
            style={styles.closeBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </TouchableOpacity>
          <View style={styles.dots}>
            {QUESTIONS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i <= step && styles.dotActive,
                ]}
              />
            ))}
          </View>
          <Text style={styles.step}>
            {step + 1} / {total}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.seedCrumb}>{seed}</Text>
          <Text style={styles.question}>{QUESTIONS[step]}</Text>
          <GlassSurface radius={radius.card} tint="paper" style={styles.inputWrap}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder="In your own words…"
              placeholderTextColor={colors.muted}
              style={styles.input}
              multiline
              autoFocus
              textAlignVertical="top"
            />
          </GlassSurface>
        </ScrollView>

        <View style={[styles.foot, { paddingBottom: insets.bottom + space[4] }]}>
          <GlassButton
            label="This is everything →"
            variant="glass"
            disabled={!canEnd}
            onPress={end}
          />
          <GlassButton
            label="Next →"
            variant="primary"
            disabled={!canAdvance}
            onPress={next}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[5],
    paddingBottom: space[4],
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  closeGlyph: { fontSize: 18, color: colors.muted, fontFamily: fonts.sans },
  dots: { flex: 1, flexDirection: "row", gap: space[2], alignItems: "center" },
  dot: {
    height: 4,
    flex: 1,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  dotActive: { backgroundColor: colors.accent },
  step: {
    fontFamily: fonts.sansMedium,
    fontSize: type.small,
    color: colors.muted,
    minWidth: 44,
    textAlign: "right",
  },
  body: {
    paddingHorizontal: space[6],
    paddingTop: space[6],
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  seedCrumb: {
    fontFamily: fonts.sansMedium,
    fontSize: type.small,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: space[3],
  },
  question: {
    fontFamily: fonts.display,
    fontSize: type.displayLg,
    lineHeight: type.displayLg * leading.tight,
    color: colors.foreground,
    letterSpacing: -0.5,
    marginBottom: space[6],
  },
  inputWrap: { padding: space[2] },
  input: {
    minHeight: 160,
    padding: space[4],
    fontFamily: fonts.sans,
    fontSize: type.essay,
    lineHeight: type.essay * leading.body,
    color: colors.foreground,
  },
  foot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[6],
    paddingTop: space[3],
  },
  // Read view
  readContent: {
    paddingHorizontal: space[6],
    maxWidth: 680,
    width: "100%",
    alignSelf: "center",
  },
  closeRow: { marginBottom: space[5] },
  closeText: {
    fontFamily: fonts.sansMedium,
    fontSize: type.base,
    color: colors.muted,
  },
  essayTitle: {
    fontFamily: fonts.display,
    fontSize: type.displayLg,
    lineHeight: type.displayLg * leading.tight,
    color: colors.foreground,
    letterSpacing: -0.5,
    marginBottom: space[6],
  },
  stitchNote: {
    marginTop: space[4],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  stitchNoteText: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.foreground,
  },
});
