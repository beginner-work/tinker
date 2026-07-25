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

/** Social adjacency — find founders near your writing. */
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
          <Text style={styles.title}>Find my founders</Text>
          <Text style={styles.lede}>
            Adjacency around what you&apos;ve written — not a social feed.
          </Text>

          <Pressable onPress={find} disabled={busy} style={{ marginBottom: 20 }}>
            <TinkerGlass shape="capsule" style={styles.cta}>
              {busy ? (
                <ActivityIndicator color={colors.accentStrong} />
              ) : (
                <Text style={styles.ctaText}>Look around</Text>
              )}
            </TinkerGlass>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {searched && !error && hits.length === 0 ? (
            <Text style={styles.empty}>
              No neighbors yet. Publish a few essays and try again.
            </Text>
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
