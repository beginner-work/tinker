import { useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { listEssays } from "../src/lib/drafts";
import type { Essay } from "../src/api/userData";
import { colors, fonts, type } from "../src/theme";

export default function ReadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [essay, setEssay] = useState<Essay | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const all = await listEssays();
        const found = all.find((e) => e.id === id) || null;
        if (!mounted) return;
        if (!found) setError("That essay isn't here anymore.");
        else setEssay(found);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Couldn't load the essay.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.topAction}>Close</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/pitch-script")} hitSlop={8}>
          <Text style={styles.topAction}>Pitch script</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {essay ? (
          <>
            <Text style={styles.title}>{essay.title}</Text>
            <Text style={styles.meta}>
              {essay.seed ? `${essay.seed} · ` : ""}
              {new Date(essay.createdAt).toLocaleDateString()}
            </Text>
            {essay.github?.prUrl ? (
              <Pressable
                onPress={() => Linking.openURL(essay.github!.prUrl)}
                style={{ marginBottom: 20 }}
              >
                <Text style={styles.prLink}>
                  Open pull request
                  {essay.github.prNumber ? ` #${essay.github.prNumber}` : ""} →
                </Text>
              </Pressable>
            ) : null}
            <Text style={styles.prose}>{essay.body}</Text>
          </>
        ) : !error ? (
          <Text style={styles.meta}>Loading…</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topAction: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
  },
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  title: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 38,
    color: colors.foreground,
    marginBottom: 8,
  },
  meta: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.muted,
    marginBottom: 12,
  },
  prLink: {
    fontFamily: fonts.sansMedium,
    fontSize: type.body,
    color: colors.accentStrong,
  },
  prose: {
    fontFamily: fonts.sans,
    fontSize: type.essay,
    lineHeight: type.essay * 1.7,
    color: colors.foreground,
  },
  error: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.foreground,
    backgroundColor: colors.errorBg,
    padding: 12,
    borderRadius: 10,
  },
});
