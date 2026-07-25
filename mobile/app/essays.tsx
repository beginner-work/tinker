import { useCallback, useState } from "react";
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
import { AppChrome } from "../src/components/AppChrome";
import { listEssays } from "../src/lib/drafts";
import type { Essay } from "../src/api/userData";
import { colors, fonts, radius, type } from "../src/theme";

export default function EssaysScreen() {
  const [essays, setEssays] = useState<Essay[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setEssays(await listEssays());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <AppChrome showModeNav={false}>
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <Text style={styles.title}>Essays</Text>
        <FlatList
          data={essays}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={load} />
          }
          contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 24 }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Nothing published yet. Pick a place on the home screen to start.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
              ]}
              onPress={() =>
                router.push({ pathname: "/read", params: { id: item.id } })
              }
            >
              <Text style={styles.rowTitle} numberOfLines={2}>
                {item.title || "Untitled"}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={2}>
                {item.github?.prNumber
                  ? `PR #${item.github.prNumber} · `
                  : item.github?.prUrl
                    ? "PR open · "
                    : ""}
                {item.body}
              </Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 56 },
  title: {
    fontFamily: fonts.display,
    fontSize: type.display,
    color: colors.foreground,
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  empty: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
    marginTop: 24,
  },
  row: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 10,
  },
  rowPressed: { borderColor: colors.accentStrong },
  rowTitle: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
    marginBottom: 6,
  },
  rowMeta: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.muted,
    lineHeight: 18,
  },
});
