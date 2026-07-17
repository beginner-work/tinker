import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  colorsFor,
  fonts,
  radius,
  space,
  text,
  type ColorMode,
} from "../theme";
import { STR } from "../strings";
import {
  ACTIVITY_ITEMS,
  DISCOVER_ITEMS,
  type ActivityItem,
  type DiscoverItem,
} from "../data/seedProgress";
import { DISCOVER_ICONS, Ionicons, TAB_ICONS, UI_ICONS } from "../icons";

type NavTarget = "explore" | "connect" | "coverage" | "progress" | "home" | "feed";

type Props = {
  mode: ColorMode;
  onToggleMode: () => void;
  onNavigate: (target: NavTarget) => void;
  connected?: boolean;
};

function DiscoverRow({
  item,
  mode,
  onPress,
}: {
  item: DiscoverItem;
  mode: ColorMode;
  onPress: () => void;
}) {
  const c = colorsFor(mode);
  const tint =
    item.tint === "coverage"
      ? c.iconCoverage
      : item.tint === "connect"
        ? c.iconConnect
        : c.iconProgress;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.discoverRow,
        pressed && { opacity: 0.72 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={item.label}
    >
      <View style={[styles.discoverIcon, { backgroundColor: tint }]}>
        <Ionicons name={DISCOVER_ICONS[item.tint]} size={18} color="#fffdf7" />
      </View>
      <Text
        style={[styles.discoverLabel, { color: c.ink, fontFamily: fonts.sansMed }]}
      >
        {item.label}
      </Text>
      <Ionicons name={UI_ICONS.chevron} size={18} color={c.inkSoft} />
    </Pressable>
  );
}

function ActivityCard({
  item,
  mode,
}: {
  item: ActivityItem;
  mode: ColorMode;
}) {
  const c = colorsFor(mode);
  return (
    <View style={styles.activityBlock}>
      <View style={styles.activityHeader}>
        <View style={[styles.avatar, { backgroundColor: c.avatarBg }]}>
          <Text
            style={[
              styles.avatarLetter,
              { color: c.avatarInk, fontFamily: fonts.sansBold },
            ]}
          >
            {item.actor.slice(0, 1)}
          </Text>
        </View>
        <Text
          style={[styles.activityMeta, { color: c.ink, fontFamily: fonts.sans }]}
          numberOfLines={2}
        >
          {item.actor} {STR.contributedTo}{" "}
          <Text style={{ fontFamily: fonts.sansBold }}>{item.target}</Text>
        </Text>
        <Text
          style={[styles.when, { color: c.inkSoft, fontFamily: fonts.sans }]}
        >
          {item.when}
        </Text>
      </View>
      <View
        style={[
          styles.activityCard,
          { backgroundColor: c.surface, borderColor: c.border },
        ]}
      >
        <Text
          style={[
            styles.repoLine,
            { color: c.inkMuted, fontFamily: fonts.sansMed },
          ]}
        >
          {STR.brand} / {item.kind}
        </Text>
        <Text
          style={[styles.activityTitle, { color: c.ink, fontFamily: fonts.sansSemi }]}
        >
          {item.title}
        </Text>
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.badge,
              {
                backgroundColor:
                  item.lane === "source" ? c.accentMuted : c.badge,
              },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                {
                  color: item.lane === "source" ? c.accent : c.badgeInk,
                  fontFamily: fonts.sansSemi,
                },
              ]}
            >
              {item.badge}
            </Text>
          </View>
        </View>
        <Text
          style={[styles.activityDetail, { color: c.inkMuted, fontFamily: fonts.sans }]}
          numberOfLines={3}
        >
          {item.detail}
        </Text>
      </View>
    </View>
  );
}

/**
 * View 1 — GitHub Explore–shaped progress surface (tinker fonts + tokens).
 * Discover + Activity; floating pill tab bar; no source in the feed.
 */
export function FeedScreen({ mode, onToggleMode, onNavigate, connected }: Props) {
  const c = colorsFor(mode);
  const tabs = [
    { key: "home" as const, label: STR.home },
    { key: "feed" as const, label: STR.feed },
    { key: "explore" as const, label: STR.explore, active: true },
    { key: "progress" as const, label: STR.progress },
  ];

  function onDiscoverPress(item: DiscoverItem) {
    if (item.tint === "connect") onNavigate("connect");
    else if (item.tint === "coverage") onNavigate("coverage");
    else onNavigate("progress");
  }

  return (
    <View
      style={[styles.root, { backgroundColor: c.background }]}
      accessibilityLabel={STR.explore}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Text
            style={[styles.title, { color: c.ink, fontFamily: fonts.display }]}
          >
            {STR.explore}
          </Text>
          <View style={styles.topActions}>
            <Pressable
              onPress={onToggleMode}
              style={[styles.modeChip, { borderColor: c.border }]}
              accessibilityRole="button"
              accessibilityLabel={mode === "dark" ? STR.light : STR.dark}
            >
              <Text
                style={[
                  styles.modeChipText,
                  { color: c.inkMuted, fontFamily: fonts.sansSemi },
                ]}
              >
                {mode === "dark" ? STR.light : STR.dark}
              </Text>
            </Pressable>
            <View
              style={[styles.searchBtn, { backgroundColor: c.surface, borderColor: c.border }]}
              accessibilityLabel={STR.search}
            >
              <Ionicons name={UI_ICONS.search} size={18} color={c.ink} />
            </View>
          </View>
        </View>

        <Text
          style={[styles.section, { color: c.ink, fontFamily: fonts.sansSemi }]}
        >
          {STR.discover}
        </Text>
        <View
          style={[
            styles.discoverCard,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          {DISCOVER_ITEMS.map((item, i) => (
            <View key={item.id}>
              <DiscoverRow
                item={item}
                mode={mode}
                onPress={() => onDiscoverPress(item)}
              />
              {i < DISCOVER_ITEMS.length - 1 ? (
                <View style={[styles.hairline, { backgroundColor: c.hairline }]} />
              ) : null}
            </View>
          ))}
        </View>

        {connected ? (
          <View
            style={[
              styles.connectedBanner,
              { backgroundColor: c.accentMuted, borderColor: c.border },
            ]}
          >
            <Ionicons name="link" size={16} color={c.accent} />
            <Text
              style={[
                styles.connectedText,
                { color: c.accent, fontFamily: fonts.sansSemi },
              ]}
            >
              {STR.connected}
            </Text>
          </View>
        ) : null}

        <View style={styles.activityHeading}>
          <Text
            style={[styles.section, { color: c.ink, fontFamily: fonts.sansSemi, marginBottom: 0 }]}
          >
            {STR.activity}
          </Text>
        </View>
        <Text
          style={[styles.sub, { color: c.inkMuted, fontFamily: fonts.sans }]}
        >
          {STR.noSourceInFeed}
        </Text>

        {ACTIVITY_ITEMS.length === 0 ? (
          <Text style={[styles.empty, { color: c.inkMuted, fontFamily: fonts.sans }]}>
            {STR.emptyFeed}
          </Text>
        ) : (
          ACTIVITY_ITEMS.map((item) => (
            <ActivityCard key={item.id} item={item} mode={mode} />
          ))
        )}
      </ScrollView>

      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: c.navBg,
            shadowColor: c.navShadow,
            borderColor: c.border,
          },
        ]}
      >
        {tabs.map((tab) => {
          const active = "active" in tab && Boolean(tab.active);
          const iconSet = TAB_ICONS[tab.key];
          return (
            <Pressable
              key={tab.key}
              style={styles.tabItem}
              onPress={() => onNavigate(tab.key)}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
            >
              <View
                style={[
                  styles.tabIconWrap,
                  active && { backgroundColor: c.accentMuted },
                ]}
              >
                <Ionicons
                  name={active ? iconSet.filled : iconSet.outline}
                  size={20}
                  color={active ? c.accent : c.inkSoft}
                />
              </View>
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: active ? c.accent : c.inkSoft,
                    fontFamily: active ? fonts.sansSemi : fonts.sans,
                  },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: space[5],
    paddingTop: space[6],
    paddingBottom: 120,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space[6],
  },
  title: {
    fontSize: text.title,
    letterSpacing: -0.5,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  modeChip: {
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.chip,
  },
  modeChipText: { fontSize: text.micro },
  searchBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    fontSize: text.section,
    marginBottom: space[3],
  },
  discoverCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: space[4],
    overflow: "hidden",
  },
  connectedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    marginBottom: space[5],
  },
  connectedText: { fontSize: text.small },
  discoverRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    gap: space[4],
  },
  discoverIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.icon,
    alignItems: "center",
    justifyContent: "center",
  },
  discoverLabel: {
    flex: 1,
    fontSize: text.base,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
  activityHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space[2],
  },
  sub: {
    fontSize: text.small,
    marginBottom: space[5],
  },
  empty: {
    fontSize: text.body,
    paddingVertical: space[8],
  },
  activityBlock: {
    marginBottom: space[6],
  },
  activityHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    marginBottom: space[3],
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: { fontSize: text.small },
  activityMeta: {
    flex: 1,
    fontSize: text.body,
    lineHeight: 20,
  },
  when: {
    fontSize: text.small,
    marginTop: 2,
  },
  activityCard: {
    marginLeft: 40,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space[4],
  },
  repoLine: {
    fontSize: text.small,
    marginBottom: space[2],
  },
  activityTitle: {
    fontSize: text.essay,
    lineHeight: 22,
    marginBottom: space[3],
  },
  badgeRow: {
    flexDirection: "row",
    marginBottom: space[3],
  },
  badge: {
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.pill,
  },
  badgeText: { fontSize: text.micro },
  activityDetail: {
    fontSize: text.small,
    lineHeight: 18,
  },
  tabBar: {
    position: "absolute",
    left: space[5],
    right: space[5],
    bottom: space[5],
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: space[3],
    paddingHorizontal: space[2],
    borderRadius: radius.nav,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 8,
  },
  tabItem: {
    alignItems: "center",
    minWidth: 64,
    gap: 2,
  },
  tabIconWrap: {
    width: 40,
    height: 28,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: { fontSize: text.micro },
});
