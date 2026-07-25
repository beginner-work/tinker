import { useState } from "react";
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
import { saveEssay } from "../src/lib/drafts";
import { colors, fonts, radius, type } from "../src/theme";
import { AppChrome } from "../src/components/AppChrome";

/** No AI mode — one textarea, founder words only. */
export default function FreewriteScreen() {
  const { seed } = useLocalSearchParams<{ seed?: string }>();
  const { signedIn } = useAuth();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await saveEssay(essay);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      router.replace({ pathname: "/assessing", params: { id } });
    } catch (e: any) {
      setError(e?.message || "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppChrome mode="noai" onModeChange={(m) => m === "ai" && router.push("/")} showModeNav>
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={styles.topAction}>Close</Text>
            </Pressable>
            <Text style={styles.badge}>No AI</Text>
          </View>
          <Text style={styles.lede}>
            Write freely
            {seed ? ` — ${seed}` : ""}. Every word is yours.
          </Text>
          <TextInput
            style={styles.input}
            value={body}
            onChangeText={setBody}
            placeholder="Start writing…"
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
              {busy ? "Saving…" : "Publish →"}
            </Text>
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    paddingBottom: 12,
  },
  topAction: { fontFamily: fonts.sans, fontSize: type.body, color: colors.muted },
  badge: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.micro,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.accentStrong,
  },
  lede: {
    fontFamily: fonts.display,
    fontSize: type.display,
    color: colors.foreground,
    marginBottom: 16,
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
