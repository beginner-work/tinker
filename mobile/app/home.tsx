import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "../src/auth/AuthContext";
import { Draft, getDrafts, putDrafts, uid } from "../src/api/userData";
import { colors, fonts, radius, rainbow, type } from "../src/theme";

export default function Home() {
  const { signedIn, signOut } = useAuth();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (signedIn === false) router.replace("/sign-in");
  }, [signedIn]);

  const load = useCallback(async () => {
    try {
      setDrafts(await getDrafts());
    } catch {
      // Offline or expired session — the 401 handler redirects; other
      // failures keep whatever list we already have.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function startWriting() {
    if (creating) return;
    setCreating(true);
    try {
      const draft: Draft = {
        id: uid(),
        title: "Untitled draft",
        transcript: [],
        currentStep: 0,
        stitched: null,
        pending: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const server = await getDrafts().catch(() => drafts);
      await putDrafts([draft, ...server.filter((d) => d.id !== draft.id)]);
      router.push({ pathname: "/write", params: { id: draft.id } });
    } finally {
      setCreating(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>tinker</Text>
        <Pressable onPress={signOut} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.rainbowRow}>
        {rainbow.map((c) => (
          <View key={c} style={[styles.rainbowDot, { backgroundColor: c }]} />
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [styles.startCard, pressed && styles.startCardPressed]}
        onPress={startWriting}
        disabled={creating}
      >
        <Text style={styles.startQuestion}>What are you learning?</Text>
        <Text style={styles.startHint}>
          {creating ? "Opening…" : "Answer out loud or type — one question at a time."}
        </Text>
      </Pressable>

      <Text style={styles.sectionLabel}>DRAFTS</Text>
      <FlatList
        data={drafts}
        keyExtractor={(d) => d.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.draftRow, pressed && styles.draftRowPressed]}
            onPress={() => router.push({ pathname: "/write", params: { id: item.id } })}
          >
            <Text style={styles.draftTitle} numberOfLines={1}>
              {item.title || "Untitled draft"}
            </Text>
            <Text style={styles.draftMeta}>
              {item.transcript?.length
                ? `${item.transcript.length} answer${item.transcript.length === 1 ? "" : "s"}`
                : "Not started"}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Nothing in progress — start above.</Text>
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  brand: { fontFamily: fonts.display, fontSize: type.display, color: colors.foreground },
  signOut: { fontFamily: fonts.sans, fontSize: type.small, color: colors.muted },
  rainbowRow: { flexDirection: "row", gap: 6, marginBottom: 20 },
  rainbowDot: { width: 10, height: 10, borderRadius: 5 },
  startCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 20,
    marginBottom: 28,
  },
  startCardPressed: { backgroundColor: colors.accentDim },
  startQuestion: {
    fontFamily: fonts.display,
    fontSize: type.displayLg - 8,
    lineHeight: (type.displayLg - 8) * 1.1,
    color: colors.foreground,
    marginBottom: 8,
  },
  startHint: { fontFamily: fonts.sans, fontSize: type.body, color: colors.muted },
  sectionLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.micro,
    letterSpacing: 1,
    color: colors.muted,
    marginBottom: 8,
  },
  draftRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  draftRowPressed: { backgroundColor: colors.surfaceAlt },
  draftTitle: { fontFamily: fonts.sansMedium, fontSize: type.base, color: colors.foreground },
  draftMeta: { fontFamily: fonts.sans, fontSize: type.small, color: colors.muted, marginTop: 2 },
  empty: { fontFamily: fonts.sans, fontSize: type.body, color: colors.muted, paddingVertical: 12 },
});
