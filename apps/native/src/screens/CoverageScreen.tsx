import { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
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
import { Ionicons, UI_ICONS } from "../icons";
import { COVERAGE_ROWS, type CoverageRow } from "../data/coverageSeeds";
import type { ConnectionState } from "../data/connectSeeds";
import { PITCH_OPTIONS, REPO_OPTIONS } from "../data/connectSeeds";

type Props = {
  mode: ColorMode;
  connection: ConnectionState;
  onBack: () => void;
  onConnect: () => void;
};

function StatusChip({
  status,
  mode,
}: {
  status: CoverageRow["status"];
  mode: ColorMode;
}) {
  const c = colorsFor(mode);
  const aligned = status === "aligned";
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: aligned ? c.accentMuted : "rgba(196, 100, 80, 0.12)",
        },
      ]}
    >
      <Ionicons
        name={aligned ? "checkmark-circle" : "alert-circle-outline"}
        size={14}
        color={aligned ? c.accent : "#b4533c"}
      />
      <Text
        style={[
          styles.chipText,
          {
            color: aligned ? c.accent : "#b4533c",
            fontFamily: fonts.sansSemi,
          },
        ]}
      >
        {aligned ? STR.aligned : STR.unaligned}
      </Text>
    </View>
  );
}

/**
 * View 3 — one orthogonal side-by-side pair at a time; swipe through pairs.
 * Left: one pitch idea. Right: one source surface + alignment.
 * Meta uses human labels (Pitch / Repository titles) — never opaque slugs.
 */
export function CoverageScreen({ mode, connection, onBack, onConnect }: Props) {
  const c = colorsFor(mode);
  const pitch = PITCH_OPTIONS.find((p) => p.slug === connection.pitchSlug);
  const repo = REPO_OPTIONS.find((r) => r.slug === connection.repoSlug);
  const connected = Boolean(connection.connectedAt && pitch && repo);

  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<CoverageRow>>(null);
  const pageWidth = Dimensions.get("window").width;

  const alignedCount = COVERAGE_ROWS.filter((r) => r.status === "aligned").length;
  const gapCount = COVERAGE_ROWS.length - alignedCount;

  function onMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    setIndex(Math.max(0, Math.min(COVERAGE_ROWS.length - 1, next)));
  }

  return (
    <View
      style={[styles.root, { backgroundColor: c.background }]}
      accessibilityLabel={STR.coverage}
    >
      <View style={styles.topBar}>
        <Pressable
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={STR.back}
        >
          <Ionicons name="chevron-back" size={22} color={c.ink} />
          <Text style={[styles.backLabel, { color: c.ink, fontFamily: fonts.sansMed }]}>
            {STR.back}
          </Text>
        </Pressable>
        <View
          style={[styles.searchBtn, { backgroundColor: c.surface, borderColor: c.border }]}
          accessibilityLabel={STR.search}
        >
          <Ionicons name={UI_ICONS.search} size={18} color={c.ink} />
        </View>
      </View>

      <View style={styles.headerBlock}>
        <Text style={[styles.title, { color: c.ink, fontFamily: fonts.display }]}>
          {STR.coverage}
        </Text>
        <Text style={[styles.sub, { color: c.inkMuted, fontFamily: fonts.sans }]}>
          {STR.swipePairs}
        </Text>
      </View>

      {!connected ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.empty, { color: c.inkMuted, fontFamily: fonts.sans }]}>
            {STR.connectPitchFirst}
          </Text>
          <Pressable
            onPress={onConnect}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: pressed ? c.accentPress : c.accent },
            ]}
            accessibilityRole="button"
            accessibilityLabel={STR.connect}
          >
            <Text
              style={[
                styles.primaryLabel,
                { color: "#fffdf7", fontFamily: fonts.sansBold },
              ]}
            >
              {STR.connect}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.metaBlock}>
            <Text style={[styles.metaLine, { color: c.inkSoft, fontFamily: fonts.sans }]}>
              <Text style={{ fontFamily: fonts.sansSemi, color: c.inkMuted }}>
                {STR.pitch}
              </Text>
              {" · "}
              {pitch?.title}
            </Text>
            <Text style={[styles.metaLine, { color: c.inkSoft, fontFamily: fonts.sans }]}>
              <Text style={{ fontFamily: fonts.sansSemi, color: c.inkMuted }}>
                {STR.repository}
              </Text>
              {" · "}
              {repo?.title}
            </Text>
          </View>

          <View style={styles.counts}>
            <Text style={[styles.count, { color: c.accent, fontFamily: fonts.sansSemi }]}>
              {STR.covered}: {alignedCount}
            </Text>
            <Text style={[styles.count, { color: "#b4533c", fontFamily: fonts.sansSemi }]}>
              {STR.gap}: {gapCount}
            </Text>
          </View>

          <FlatList
            ref={listRef}
            data={COVERAGE_ROWS}
            keyExtractor={(item) => item.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
            style={styles.pager}
            renderItem={({ item }) => (
              <View style={[styles.page, { width: pageWidth }]}>
                <View
                  style={[
                    styles.pairCard,
                    { backgroundColor: c.surface, borderColor: c.border },
                  ]}
                >
                  <View
                    style={[
                      styles.half,
                      styles.halfLeft,
                      { borderRightColor: c.hairline },
                    ]}
                  >
                    <View style={styles.halfHead}>
                      <Ionicons
                        name="document-text-outline"
                        size={14}
                        color={c.forest}
                      />
                      <Text
                        style={[
                          styles.halfTitle,
                          { color: c.ink, fontFamily: fonts.sansSemi },
                        ]}
                      >
                        {STR.yourWords}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.ideaText,
                        { color: c.ink, fontFamily: fonts.displaySemi },
                      ]}
                    >
                      {item.idea}
                    </Text>
                  </View>

                  <View style={styles.half}>
                    <View style={styles.halfHead}>
                      <Ionicons
                        name="git-branch-outline"
                        size={14}
                        color={c.forest}
                      />
                      <Text
                        style={[
                          styles.halfTitle,
                          { color: c.ink, fontFamily: fonts.sansSemi },
                        ]}
                      >
                        {STR.inYourApp}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.surfaceText,
                        { color: c.ink, fontFamily: fonts.sansSemi },
                      ]}
                    >
                      {item.surface}
                    </Text>
                    <StatusChip status={item.status} mode={mode} />
                  </View>
                </View>
              </View>
            )}
          />

          <View style={styles.footer}>
            <Text
              style={[styles.pageLabel, { color: c.inkMuted, fontFamily: fonts.sansMed }]}
            >
              {index + 1} {STR.of} {COVERAGE_ROWS.length}
            </Text>
            <View style={styles.dots}>
              {COVERAGE_ROWS.map((row, i) => (
                <Pressable
                  key={row.id}
                  onPress={() => {
                    listRef.current?.scrollToIndex({ index: i, animated: true });
                    setIndex(i);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${STR.coverage} ${i + 1}`}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: i === index ? c.accent : c.border,
                    },
                  ]}
                />
              ))}
            </View>
            <Text
              style={[styles.hint, { color: c.inkSoft, fontFamily: fonts.sans }]}
            >
              {STR.swipeHint}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[5],
    paddingTop: space[5],
    marginBottom: space[2],
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: space[2],
  },
  backLabel: { fontSize: text.base },
  searchBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBlock: {
    paddingHorizontal: space[5],
    marginBottom: space[3],
  },
  title: {
    fontSize: text.title,
    letterSpacing: -0.5,
    marginBottom: space[1],
  },
  sub: { fontSize: text.small },
  metaBlock: {
    paddingHorizontal: space[5],
    marginBottom: space[3],
    gap: 4,
  },
  metaLine: {
    fontSize: text.small,
    lineHeight: 18,
  },
  counts: {
    flexDirection: "row",
    gap: space[4],
    paddingHorizontal: space[5],
    marginBottom: space[4],
  },
  count: { fontSize: text.small },
  pager: { flexGrow: 0 },
  page: {
    paddingHorizontal: space[5],
  },
  pairCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: radius.card,
    overflow: "hidden",
    minHeight: 280,
  },
  half: {
    flex: 1,
    minWidth: 0,
    padding: space[4],
    gap: space[3],
  },
  halfLeft: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  halfHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  halfTitle: {
    fontSize: text.micro,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  ideaText: {
    fontSize: text.essay,
    lineHeight: 24,
    flex: 1,
  },
  surfaceText: {
    fontSize: text.display,
    lineHeight: 28,
    letterSpacing: -0.3,
    flex: 1,
  },
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.pill,
  },
  chipText: { fontSize: text.micro },
  footer: {
    alignItems: "center",
    paddingTop: space[5],
    paddingBottom: space[6],
    gap: space[3],
  },
  pageLabel: { fontSize: text.small },
  dots: {
    flexDirection: "row",
    gap: space[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  hint: { fontSize: text.micro },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: space[6],
    justifyContent: "center",
    gap: space[5],
  },
  empty: {
    fontSize: text.essay,
    lineHeight: 24,
    textAlign: "center",
  },
  primaryBtn: {
    alignSelf: "center",
    borderRadius: radius.button,
    paddingVertical: space[4],
    paddingHorizontal: space[6],
  },
  primaryLabel: { fontSize: text.base },
});
