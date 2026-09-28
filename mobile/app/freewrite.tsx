import { useEffect, useState } from "react";
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
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "../src/auth/AuthContext";
import { Essay, essayId } from "../src/api/userData";
import { firstSentence, slugify } from "../src/lib/interview";
import { publishEssayWithPullRequest } from "../src/lib/drafts";
import { isGitHubConnected } from "../src/lib/github";
import { colors, fonts, radius, type } from "../src/theme";
import { AppChrome } from "../src/components/AppChrome";

/**
 * No AI mode — same card copy as src/renderer/writing.js
 * renderFreewriteCompose (What are you learning? / This is everything →).
 */
export default function FreewriteScreen() {
  const { seed } = useLocalSearchParams<{ seed?: string }>();
  const { signedIn } = useAuth();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gated, setGated] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (signedIn === false) {
      router.replace("/sign-in");
      return;
    }
    let mounted = true;
    (async () => {
      const ok = await isGitHubConnected();
      if (!mounted) return;
      if (!ok) {
        router.replace({
          pathname: "/connect-repo",
          params: { next: "write", seed: seed || "", mode: "noai" },
        });
        return;
      }
      setGated(false);
    })();
    return () => {
      mounted = false;
    };
  }, [signedIn, seed]);

  async function publish() {
    if (signedIn === false) {
      router.push("/sign-in");
      return;
    }
    const text = body.trim();
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
        seed: seed || null,
      };
      const { essay: savedEssay, prError } = await publishEssayWithPullRequest(
        essay,
      );
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      setSaved(true);
      // Brief web-parity "Saved on this device" beat, then assessing.
      setTimeout(() => {
        router.replace({
          pathname: "/assessing",
          params: {
            id: savedEssay.id,
            prUrl: savedEssay.github?.prUrl || "",
            prError: prError || "",
          },
        });
      }, 900);
    } catch (e: any) {
      setError(e?.message || "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (gated) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.meta}>Checking GitHub repo…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (saved) {
    return (
      <AppChrome mode="noai" showModeNav>
        <SafeAreaView style={styles.screen} edges={["bottom"]}>
          <View style={styles.savedCard}>
            <Text style={styles.question}>Saved on this device.</Text>
            <Text style={styles.savedSub}>
              When you reconnect, this goes to your pitch like any other essay.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.replace("/")}
            >
              <Text style={styles.buttonText}>Done</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </AppChrome>
    );
  }

  return (
    <AppChrome
      mode="noai"
      onModeChange={(m) => m === "ai" && router.push("/")}
      showModeNav
    >
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.card}>
            <Text style={styles.question}>What are you learning?</Text>
            <TextInput
              style={styles.input}
              value={body}
              onChangeText={setBody}
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
                (!body.trim() || busy) && styles.buttonDisabled,
              ]}
              onPress={publish}
              disabled={!body.trim() || busy}
            >
              <Text style={styles.buttonText}>
                {busy ? "…" : "This is everything →"}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  meta: { fontFamily: fonts.sans, fontSize: type.body, color: colors.muted },
  card: { flex: 1, paddingTop: 24 },
  savedCard: { flex: 1, justifyContent: "center", paddingBottom: 88 },
  question: {
    fontFamily: fonts.display,
    fontSize: type.displayLg - 6,
    lineHeight: (type.displayLg - 6) * 1.15,
    color: colors.foreground,
    marginBottom: 20,
  },
  savedSub: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    lineHeight: 22,
    color: colors.muted,
    marginBottom: 28,
  },
  input: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: type.essay,
    lineHeight: type.essay * 1.6,
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
    padding: 10,
    marginBottom: 10,
  },
  button: {
    backgroundColor: colors.accentStrong,
    borderRadius: radius.button,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 88,
  },
  buttonPressed: { backgroundColor: colors.accentPress },
  buttonDisabled: { opacity: 0.45 },
  buttonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.surface,
  },
});
