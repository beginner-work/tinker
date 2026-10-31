import { useCallback, useEffect, useState } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import * as Clipboard from "expo-clipboard";
import { BrandMark } from "@/src/components/BrandMark";
import { colors, fonts, space } from "@/src/theme/tokens";

function extractUrl(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const match = s.match(/https?:\/\/[^\s<>"']+/i);
  return (match ? match[0] : s).replace(/[.,);]+$/, "");
}

export default function HomeScreen() {
  const params = useLocalSearchParams<{ url?: string }>();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [url, setUrl] = useState(String(params.url || ""));
  const [error, setError] = useState("");

  useEffect(() => {
    if (params.url) setUrl(String(params.url));
  }, [params.url]);

  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return;
    const shared =
      shareIntent.webUrl ||
      shareIntent.text ||
      (Array.isArray(shareIntent.files) ? "" : "") ||
      "";
    const next = extractUrl(String(shared));
    if (next) {
      setUrl(next);
      resetShareIntent();
    }
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  const openReader = useCallback(() => {
    const next = extractUrl(url);
    if (!next || !/^https?:\/\//i.test(next)) {
      setError("Paste a public https link to the text you want to engage with.");
      return;
    }
    setError("");
    router.push({ pathname: "/read", params: { url: next } });
  }, [url]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const clip = await Clipboard.getStringAsync();
      const next = extractUrl(clip);
      if (next) setUrl(next);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <LinearGradient colors={[colors.bg0, colors.bg1]} style={styles.flex}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <BrandMark size="hero" />
          <Text style={styles.headline}>Engage with expert text.</Text>
          <Text style={styles.lede}>
            Stuck on docs, a dense README, or a talk you are hearing for the first
            time? Tinker reads it aloud, answers grounded questions, then picks
            back up where you left off — with a non-Tyler voice.
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>Link to the text</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://…/docs/… or a README, transcript, …"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Text URL"
              returnKeyType="go"
              onSubmitEditing={openReader}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                style={[styles.btn, styles.ghost]}
                onPress={pasteFromClipboard}
                accessibilityRole="button"
                accessibilityLabel="Paste URL"
              >
                <Text style={styles.ghostText}>Paste</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.primary]}
                onPress={openReader}
                accessibilityRole="button"
                accessibilityLabel="Open reader"
              >
                <Text style={styles.primaryText}>Read with Tinker</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.foot}>
            Examples: product docs when you are stuck, a README for a complex
            codebase, a talk transcript you are hearing for the first time. Share
            any https link into Tinker from Safari. A Safari page overlay ships in
            Milestone 2.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: space[6],
    paddingTop: space[8],
    paddingBottom: space[8],
    gap: space[4],
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  headline: {
    fontFamily: fonts.displaySoft,
    fontSize: 28,
    lineHeight: 34,
    color: colors.ink,
    letterSpacing: -0.4,
    marginTop: space[4],
  },
  lede: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
    maxWidth: 420,
  },
  form: {
    marginTop: space[4],
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    padding: space[5],
    gap: space[3],
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.muted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.cream,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.error,
  },
  actions: {
    flexDirection: "row",
    gap: space[3],
    marginTop: space[2],
  },
  btn: {
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    flex: 1,
    backgroundColor: colors.accent,
  },
  primaryText: {
    fontFamily: fonts.bodySemi,
    color: "#f7fff9",
    fontSize: 16,
  },
  ghost: {
    borderWidth: 1,
    borderColor: colors.line,
  },
  ghostText: {
    fontFamily: fonts.bodySemi,
    color: colors.ink,
    fontSize: 16,
  },
  foot: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    marginTop: space[3],
  },
});
