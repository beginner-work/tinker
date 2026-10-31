import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import * as Clipboard from "expo-clipboard";
import { searchLearningGoal, type SourceHit } from "@/src/api/learn";
import { SiteHeader } from "@/src/components/SiteHeader";
import { getAnonymousDeviceId } from "@/src/lib/deviceId";
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
  const [goal, setGoal] = useState("");
  const [url, setUrl] = useState(String(params.url || ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<{
    chosen: SourceHit;
    alternatives: SourceHit[];
    query: string;
  } | null>(null);

  useEffect(() => {
    if (params.url) setUrl(String(params.url));
  }, [params.url]);

  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return;
    const shared =
      shareIntent.webUrl ||
      shareIntent.text ||
      "";
    const next = extractUrl(String(shared));
    if (next) {
      setUrl(next);
      resetShareIntent();
    }
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  const openUrl = useCallback(
    (nextUrl: string, meta?: Partial<SourceHit>) => {
      const next = extractUrl(nextUrl);
      if (!next || !/^https?:\/\//i.test(next)) {
        setError("Need a public https link.");
        return;
      }
      setError("");
      router.push({
        pathname: "/read",
        params: {
          url: next,
          title: meta?.title || "",
          author: meta?.author || "",
          authorSource: meta?.authorSource || "",
          authorUnknown: meta?.authorUnknown ? "1" : "",
          siteName: meta?.siteName || meta?.domain || "",
        },
      });
    },
    [],
  );

  const openSharedOrPasted = useCallback(() => {
    openUrl(url);
  }, [openUrl, url]);

  const runLearn = useCallback(async () => {
    const q = goal.trim();
    if (!q) {
      setError("What do you want to learn?");
      return;
    }
    setError("");
    setBusy(true);
    setPick(null);
    try {
      const aid = await getAnonymousDeviceId();
      const result = await searchLearningGoal(q, { anonymousId: aid });
      setPick({
        chosen: result.chosen,
        alternatives: result.alternatives || [],
        query: result.query,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }, [goal]);

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
    <View style={styles.root}>
      <SiteHeader />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.headline}>Learn from expert text.</Text>
          <Text style={styles.lede}>
            Name what you want to learn. Tinker picks one best source, reads it
            aloud verbatim, and answers grounded questions.
          </Text>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Learning goal</Text>
            <TextInput
              style={styles.input}
              value={goal}
              onChangeText={setGoal}
              placeholder="e.g. how Postgres MVCC works"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Learning goal"
              returnKeyType="search"
              onSubmitEditing={() => void runLearn()}
            />
            <Pressable
              style={[styles.primary, busy && styles.disabled]}
              onPress={() => void runLearn()}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.primaryText}>Find a source</Text>
              )}
            </Pressable>
          </View>

          {pick ? (
            <View style={styles.pickBlock}>
              <Text style={styles.pickLabel}>Best source</Text>
              <Text style={styles.pickTitle}>{pick.chosen.title}</Text>
              <Text style={styles.pickWhy}>{pick.chosen.why}</Text>
              <Text style={styles.pickAuthor}>
                {pick.chosen.author && !pick.chosen.authorUnknown
                  ? `By ${pick.chosen.author}`
                  : "Author unknown"}
                {pick.chosen.siteName || pick.chosen.domain
                  ? ` · ${pick.chosen.siteName || pick.chosen.domain}`
                  : ""}
              </Text>
              <Pressable
                style={styles.primary}
                onPress={() => openUrl(pick.chosen.url, pick.chosen)}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Read this</Text>
              </Pressable>
              {pick.alternatives.length ? (
                <View style={styles.alts}>
                  <Text style={styles.pickLabel}>Alternatives</Text>
                  {pick.alternatives.map((alt) => (
                    <Pressable
                      key={alt.url}
                      style={styles.altRow}
                      onPress={() => openUrl(alt.url, alt)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.altTitle}>{alt.title}</Text>
                      <Text style={styles.altMeta}>
                        {alt.domain}
                        {alt.why ? ` — ${alt.why}` : ""}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.shareBlock}>
            <Text style={styles.label}>Or open a shared URL</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://…/docs/…"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Text URL"
              returnKeyType="go"
              onSubmitEditing={openSharedOrPasted}
            />
            <View style={styles.row}>
              <Pressable style={styles.ghost} onPress={pasteFromClipboard}>
                <Text style={styles.ghostText}>Paste</Text>
              </Pressable>
              <Pressable style={styles.ghost} onPress={openSharedOrPasted}>
                <Text style={styles.ghostText}>Open link</Text>
              </Pressable>
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 38,
    color: colors.ink,
    letterSpacing: -0.6,
  },
  lede: {
    fontFamily: fonts.essay,
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
    maxWidth: 420,
    letterSpacing: -0.2,
  },
  fieldBlock: { gap: space[3], marginTop: space[3] },
  shareBlock: { gap: space[3], marginTop: space[5] },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.8,
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
  primary: {
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
    minHeight: 48,
  },
  primaryText: {
    fontFamily: fonts.bodySemi,
    color: colors.bg,
    fontSize: 16,
  },
  disabled: { opacity: 0.6 },
  ghost: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.barBorder,
    backgroundColor: colors.btnBg,
  },
  ghostText: {
    fontFamily: fonts.bodySemi,
    color: colors.ink,
    fontSize: 15,
  },
  row: { flexDirection: "row", gap: space[3] },
  error: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.error,
  },
  pickBlock: {
    gap: space[3],
    paddingTop: space[2],
  },
  pickLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.muted,
  },
  pickTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 28,
    color: colors.ink,
    letterSpacing: -0.4,
  },
  pickWhy: {
    fontFamily: fonts.essay,
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  pickAuthor: {
    fontFamily: fonts.essay,
    fontSize: 14,
    color: colors.muted,
  },
  alts: { gap: space[2], marginTop: space[2] },
  altRow: {
    paddingVertical: space[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  altTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 15,
    color: colors.ink,
  },
  altMeta: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
});
