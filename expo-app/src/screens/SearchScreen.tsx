/**
 * SearchScreen — the quiet address bar. A query becomes a short essay
 * (three to five plain paragraphs with embedded links), just like the web
 * app's /api/search backed by Claude Haiku. A floating glass search bar
 * sits at the bottom (the natural home for a Liquid Glass control); the
 * answer renders as calm prose above it.
 */

import { useState } from "react";
import {
  ActivityIndicator,
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
import { Prose } from "../components/Prose";
import { RainbowLogo } from "../components/RainbowLogo";
import { search, hasBackend } from "../lib/api";
import { colors, fonts, leading, radius, space, type } from "../theme";

type State =
  | { phase: "idle" }
  | { phase: "loading"; query: string }
  | { phase: "done"; query: string; text: string; source: "api" | "fallback" };

export function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });

  async function run() {
    const q = query.trim();
    if (!q || state.phase === "loading") return;
    setState({ phase: "loading", query: q });
    const { text, source } = await search(q);
    setState({ phase: "done", query: q, text, source });
  }

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + space[7], paddingBottom: 140 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {state.phase === "idle" && (
            <View style={styles.empty}>
              <RainbowLogo size={44} />
              <Text style={styles.emptyTitle}>A quiet place to look things up.</Text>
              <Text style={styles.emptyBody}>
                Ask anything. You&apos;ll get a short, calm essay — no ads, no ten
                blue links. Just prose, with a few real places to read more.
              </Text>
            </View>
          )}

          {state.phase !== "idle" && (
            <>
              <Text style={styles.crumb}>You asked</Text>
              <Text style={styles.queryTitle}>{state.query}</Text>
            </>
          )}

          {state.phase === "loading" && (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accentStrong} />
              <Text style={styles.loadingText}>Writing you an answer…</Text>
            </View>
          )}

          {state.phase === "done" && (
            <View style={styles.answer}>
              <Prose text={state.text} />
              {state.source === "fallback" && (
                <GlassSurface radius={radius.chip} tint="accent" style={styles.note}>
                  <Text style={styles.noteText}>
                    Offline preview essay. Connect a tinker deployment for live
                    answers from Claude.
                  </Text>
                </GlassSurface>
              )}
            </View>
          )}
        </ScrollView>

        {/* Floating glass search bar — the flagship Liquid Glass surface. */}
        <View style={[styles.barWrap, { paddingBottom: insets.bottom + space[4] }]}>
          <GlassSurface radius={radius.pill} tint="paper" interactive style={styles.bar}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={hasBackend ? "Search tinker" : "Search tinker (preview)"}
              placeholderTextColor={colors.muted}
              style={styles.barInput}
              returnKeyType="search"
              onSubmitEditing={run}
            />
            <TouchableOpacity
              onPress={run}
              accessibilityRole="button"
              accessibilityLabel="Search"
              style={styles.go}
              activeOpacity={0.8}
            >
              <Text style={styles.goText}>→</Text>
            </TouchableOpacity>
          </GlassSurface>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: space[6],
    maxWidth: 680,
    width: "100%",
    alignSelf: "center",
  },
  empty: { paddingTop: space[8], gap: space[4] },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: type.display,
    color: colors.foreground,
    marginTop: space[4],
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: type.essay,
    lineHeight: type.essay * leading.body,
    color: colors.muted,
  },
  crumb: {
    fontFamily: fonts.sansMedium,
    fontSize: type.small,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.muted,
  },
  queryTitle: {
    fontFamily: fonts.display,
    fontSize: type.display,
    color: colors.foreground,
    marginTop: space[2],
    marginBottom: space[6],
  },
  loading: { flexDirection: "row", alignItems: "center", gap: space[3] },
  loadingText: {
    fontFamily: fonts.sans,
    fontSize: type.base,
    color: colors.muted,
  },
  answer: { gap: space[4] },
  note: { paddingVertical: space[3], paddingHorizontal: space[4] },
  noteText: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.foreground,
  },
  barWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space[5],
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: space[6],
    paddingRight: space[2],
    maxWidth: 680,
    width: "100%",
    alignSelf: "center",
  },
  barInput: {
    flex: 1,
    minHeight: 52,
    fontFamily: fonts.sans,
    fontSize: type.essay,
    color: colors.foreground,
  },
  go: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  goText: { color: "#ffffff", fontSize: 20, fontFamily: fonts.sansSemi },
});
