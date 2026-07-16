import { FlatList, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { STR } from "../strings";
import { SEED_PROGRESS, type ProgressItem } from "../data/seedProgress";

function ProgressRow({ item }: { item: ProgressItem }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.kind}>{item.kind}</Text>
        <Text style={styles.when}>{item.when}</Text>
      </View>
      <Text style={styles.body}>{item.body}</Text>
    </View>
  );
}

/**
 * View 1 — LinkedIn-style progress feed shell (tinker dark).
 * Shows progress related to pitch — never source code.
 */
export function FeedScreen() {
  return (
    <View style={styles.root} accessibilityLabel={STR.feed}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>{STR.brand}</Text>
        <Text style={styles.modeChip}>{STR.dark}</Text>
      </View>
      <Text style={styles.heading}>{STR.feed}</Text>
      <Text style={styles.sub}>{STR.noSourceInFeed}</Text>
      <FlatList
        data={SEED_PROGRESS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <Text style={styles.empty}>{STR.emptyFeed}</Text>
        }
        renderItem={({ item }) => <ProgressRow item={item} />}
      />
      <View style={styles.tabBar}>
        <Text style={[styles.tab, styles.tabActive]}>{STR.feed}</Text>
        <Text style={styles.tab}>{STR.coverage}</Text>
        <Text style={styles.tab}>{STR.connect}</Text>
        <Text style={styles.tab}>{STR.progress}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingTop: theme.space.8,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.space.6,
    marginBottom: theme.space.5,
  },
  brand: {
    fontFamily: theme.fonts.display,
    fontSize: theme.text.display,
    fontWeight: "700",
    color: theme.colors.ink,
  },
  modeChip: {
    fontSize: theme.text.micro,
    fontWeight: "600",
    color: theme.colors.inkMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.space.3,
    paddingVertical: theme.space.1,
    borderRadius: theme.radius.chip,
    overflow: "hidden",
  },
  heading: {
    fontFamily: theme.fonts.display,
    fontSize: theme.text.display,
    fontWeight: "700",
    color: theme.colors.ink,
    paddingHorizontal: theme.space.6,
    marginBottom: theme.space.2,
  },
  sub: {
    fontSize: theme.text.small,
    color: theme.colors.inkMuted,
    paddingHorizontal: theme.space.6,
    marginBottom: theme.space.5,
  },
  list: {
    paddingHorizontal: theme.space.6,
    paddingBottom: theme.space.8,
    gap: 0,
  },
  sep: {
    height: theme.space.5,
  },
  row: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.card,
    padding: theme.space.6,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.space.3,
  },
  kind: {
    fontSize: theme.text.micro,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: theme.colors.forest,
  },
  when: {
    fontSize: theme.text.micro,
    color: theme.colors.inkSoft,
  },
  body: {
    fontSize: theme.text.essay,
    lineHeight: 26,
    color: theme.colors.ink,
  },
  empty: {
    fontSize: theme.text.body,
    color: theme.colors.inkMuted,
    paddingVertical: theme.space.8,
  },
  tabBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: theme.space.4,
    paddingBottom: theme.space.6,
    backgroundColor: theme.colors.surface,
  },
  tab: {
    fontSize: theme.text.small,
    color: theme.colors.inkSoft,
    fontWeight: "600",
  },
  tabActive: {
    color: theme.colors.forest,
  },
});
