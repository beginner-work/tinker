import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
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
import { Ionicons, TAB_ICONS } from "../icons";
import {
  cardsFromEvents,
  SEED_PROGRESS_CARDS,
  type ProgressCard,
} from "../data/progressSeeds";
import { fetchProgressFeed } from "../mcp/client";

type NavTarget = "explore" | "connect" | "coverage" | "progress" | "home" | "feed";

type Props = {
  mode: ColorMode;
  onToggleMode: () => void;
  onNavigate: (target: NavTarget) => void;
  connected?: boolean;
  /** Which bottom-tab opened this surface */
  activeTab?: "feed" | "progress";
};

/** Downward depth so tech cards sit behind the source card (not a side fan). */
const STACK_Y = 12;
const STACK_X = 4;
const MAX_BACK_CARDS = 3;

/**
 * Founder source-idea card in front; tech idea cards stacked behind
 * (edges peek out — deck depth, not a split layout).
 */
function ProgressCardView({
  item,
  mode,
}: {
  item: ProgressCard;
  mode: ColorMode;
}) {
  const c = colorsFor(mode);
  const backTechs = item.techIdeas.slice(0, MAX_BACK_CARDS);
  const depth = backTechs.length;

  return (
    <View style={styles.block}>
      <View style={styles.header}>
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
          style={[styles.meta, { color: c.ink, fontFamily: fonts.sans }]}
          numberOfLines={2}
        >
          {item.actor} {STR.contributedTo}{" "}
          <Text style={{ fontFamily: fonts.sansBold }}>{item.kind}</Text>
        </Text>
        <Text style={[styles.when, { color: c.inkSoft, fontFamily: fonts.sans }]}>
          {item.when}
        </Text>
      </View>

      {/* Full tech cards offset behind; bottom edges peek under the source card */}
      <View style={[styles.stackWrap, { paddingBottom: depth * STACK_Y }]}>
        {[...backTechs].reverse().map((tech, revIndex) => {
          const fromFront = depth - 1 - revIndex;
          return (
            <View
              key={`${item.id}-tech-${fromFront}`}
              style={[
                styles.techBackCard,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  top: (fromFront + 1) * STACK_Y,
                  left: (fromFront + 1) * STACK_X,
                  right: (fromFront + 1) * STACK_X,
                  zIndex: revIndex,
                },
              ]}
              accessibilityLabel={`${STR.techIdea}: ${tech}`}
            >
              <Text
                style={[
                  styles.laneLabel,
                  { color: c.forest, fontFamily: fonts.sansSemi },
                ]}
              >
                {STR.techIdea}
              </Text>
              <Text
                style={[
                  styles.techBody,
                  { color: c.inkMuted, fontFamily: fonts.sansSemi },
                ]}
                numberOfLines={2}
              >
                {tech}
              </Text>
            </View>
          );
        })}

        <View
          style={[
            styles.sourceCard,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              zIndex: depth + 1,
            },
          ]}
        >
          <Text
            style={[
              styles.repoLine,
              { color: c.inkMuted, fontFamily: fonts.sansMed },
            ]}
          >
            {item.repoTitle} / {item.kind}
          </Text>
          <Text
            style={[
              styles.laneLabel,
              { color: c.accent, fontFamily: fonts.sansSemi },
            ]}
          >
            {STR.sourceIdea}
          </Text>
          <Text
            style={[
              styles.body,
              { color: c.ink, fontFamily: fonts.displaySemi },
            ]}
          >
            {item.sourceIdea}
          </Text>
          {item.techIdeas.length > 0 ? (
            <Text
              style={[
                styles.stackHint,
                { color: c.inkSoft, fontFamily: fonts.sans },
              ]}
            >
              {item.techIdeas.length} {STR.techCards}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * View 4 — LinkedIn-style progress feed (no source).
 * Lives on MCP progress_feed when configured; otherwise seed events.
 */
export function ProgressScreen({
  mode,
  onToggleMode,
  onNavigate,
  connected,
  activeTab = "progress",
}: Props) {
  const c = colorsFor(mode);
  const [cards, setCards] = useState<ProgressCard[]>(SEED_PROGRESS_CARDS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const events = await fetchProgressFeed({ limit: 40 });
    if (events && events.length > 0) {
      setCards(cardsFromEvents(events));
    } else {
      setCards(SEED_PROGRESS_CARDS);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const tabs = [
    { key: "home" as const, label: STR.home },
    { key: "feed" as const, label: STR.feed },
    { key: "explore" as const, label: STR.explore },
    { key: "progress" as const, label: STR.progress },
  ];

  function tabActive(key: string): boolean {
    return key === activeTab;
  }

  return (
    <View
      style={[styles.root, { backgroundColor: c.background }]}
      accessibilityLabel={STR.progress}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.topBar}>
          <Text style={[styles.title, { color: c.ink, fontFamily: fonts.display }]}>
            {STR.progress}
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
            <Pressable
              onPress={onRefresh}
              style={[styles.searchBtn, { backgroundColor: c.surface, borderColor: c.border }]}
              accessibilityRole="button"
              accessibilityLabel={STR.refresh}
            >
              <Ionicons name="refresh-outline" size={18} color={c.ink} />
            </Pressable>
          </View>
        </View>

        <Text style={[styles.sub, { color: c.inkMuted, fontFamily: fonts.sans }]}>
          {STR.noSourceInFeed}
        </Text>

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

        {loading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: space[8] }} />
        ) : cards.length === 0 ? (
          <Text style={[styles.empty, { color: c.inkMuted, fontFamily: fonts.sans }]}>
            {STR.emptyFeed}
          </Text>
        ) : (
          cards.map((item) => (
            <ProgressCardView key={item.id} item={item} mode={mode} />
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
          const active = tabActive(tab.key);
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
    marginBottom: space[3],
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
  sub: {
    fontSize: text.small,
    marginBottom: space[5],
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
  empty: {
    fontSize: text.body,
    paddingVertical: space[8],
  },
  block: { marginBottom: space[7] },
  header: {
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
  meta: {
    flex: 1,
    fontSize: text.body,
    lineHeight: 20,
  },
  when: {
    fontSize: text.small,
    marginTop: 2,
  },
  stackWrap: {
    marginLeft: 40,
    position: "relative",
  },
  techBackCard: {
    position: "absolute",
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    gap: 2,
  },
  sourceCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space[4],
    gap: space[2],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  repoLine: { fontSize: text.small },
  laneLabel: {
    fontSize: text.micro,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  body: {
    fontSize: text.essay,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  techBody: {
    fontSize: text.body,
    lineHeight: 20,
  },
  stackHint: {
    fontSize: text.micro,
    marginTop: space[1],
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
