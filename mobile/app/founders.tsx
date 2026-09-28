import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { AppChrome } from "../src/components/AppChrome";
import { api } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { colors, fonts, radius, type } from "../src/theme";
import { TinkerGlass } from "../src/components/TinkerGlass";

type FounderHit = {
  id?: string;
  title?: string;
  excerpt?: string;
  author?: string;
};

/** Visible strings match src/renderer/founders.js STR allowlist. */
export default function FoundersScreen() {
  const { signedIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<FounderHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function find() {
    if (signedIn === false) {
      router.push("/sign-in");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ results?: FounderHit[]; founders?: FounderHit[] }>(
        "/api/feed/adjacent",
        { method: "POST", body: {} },
      );
      const list = r.results || r.founders || [];
      setHits(Array.isArray(list) ? list : []);
      setSearched(true);
    } catch (e: any) {
      setError(e?.message || "Couldn't search right now.");
      setHits([]);
      setSearched(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppChrome showModeNav={false}>
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>founders</Text>
          <Text style={styles.lede}>
            When you make a pitch discoverable, other founders inside tinker can
            find it as a match for their own pitch. No likes, no comments, no
            public profile — just a one-line summary and a link to your daily
            beginner.
          </Text>

          <Pressable onPress={find} disabled={busy} style={{ marginBottom: 20 }}>
            <TinkerGlass shape="capsule" style={styles.cta}>
              {busy ? (
                <ActivityIndicator color={colors.accentStrong} />
              ) : (
                <Text style={styles.ctaText}>find my founders</Text>
              )}
            </TinkerGlass>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {searched && !error && hits.length === 0 ? (
            <Text style={styles.empty}>
              {"You're early — there aren't enough founders here yet for a match. Check back as more opt in."}
            </Text>
          ) : null}

          {hits.length > 0 ? (
            <Text style={styles.section}>Founders adjacent to you</Text>
          ) : null}

          {hits.map((h, i) => (
            <View key={h.id || String(i)} style={styles.card}>
              <Text style={styles.cardTitle}>
                {h.title || h.author || "Founder"}
              </Text>
              {h.excerpt ? (
                <Text style={styles.cardBody} numberOfLines={4}>
                  {h.excerpt}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 56 },
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  title: {
    fontFamily: fonts.display,
    fontSize: type.display,
    color: colors.foreground,
    marginBottom: 8,
  },
  lede: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
    marginBottom: 20,
    lineHeight: 20,
  },
  cta: {
    alignItems: "center",
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: "center",
  },
  ctaText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
  },
  section: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
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
    marginBottom: 12,
  },
  empty: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 10,
  },
  cardTitle: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
    marginBottom: 6,
  },
  cardBody: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.muted,
    lineHeight: 18,
  },
});
