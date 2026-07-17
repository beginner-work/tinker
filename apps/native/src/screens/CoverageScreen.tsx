import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
        size={12}
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
 * View 3 — Peep-style side-by-side coverage.
 * Left: founder source ideas (verbatim). Right: repository map + alignment.
 */
export function CoverageScreen({ mode, connection, onBack, onConnect }: Props) {
  const c = colorsFor(mode);
  const pitch = PITCH_OPTIONS.find((p) => p.slug === connection.pitchSlug);
  const repo = REPO_OPTIONS.find((r) => r.slug === connection.repoSlug);
  const connected = Boolean(connection.connectedAt && pitch && repo);

  const alignedCount = COVERAGE_ROWS.filter((r) => r.status === "aligned").length;
  const gapCount = COVERAGE_ROWS.length - alignedCount;

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
          {STR.sideBySide}
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
          <View style={styles.metaRow}>
            <Text
              style={[styles.metaText, { color: c.inkSoft, fontFamily: fonts.sansMed }]}
              numberOfLines={1}
            >
              {pitch?.title}
            </Text>
            <Text style={[styles.metaSep, { color: c.inkSoft }]}>·</Text>
            <Text
              style={[styles.metaText, { color: c.inkSoft, fontFamily: fonts.sansMed }]}
              numberOfLines={1}
            >
              {repo?.slug}
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

          {/* Peep-style side-by-side panes */}
          <View
            style={[
              styles.split,
              { borderColor: c.border, backgroundColor: c.surface },
            ]}
          >
            <View style={[styles.pane, styles.paneLeft, { borderRightColor: c.hairline }]}>
              <View style={[styles.paneHead, { borderBottomColor: c.hairline }]}>
                <Ionicons name="document-text-outline" size={14} color={c.forest} />
                <Text
                  style={[
                    styles.paneTitle,
                    { color: c.ink, fontFamily: fonts.sansSemi },
                  ]}
                >
                  {STR.pitchIdeas}
                </Text>
              </View>
              <ScrollView
                style={styles.paneScroll}
                contentContainerStyle={styles.paneContent}
                showsVerticalScrollIndicator={false}
              >
                {COVERAGE_ROWS.map((row) => (
                  <View
                    key={`idea-${row.id}`}
                    style={[styles.ideaCard, { borderColor: c.border }]}
                  >
                    <Text
                      style={[
                        styles.ideaText,
                        { color: c.ink, fontFamily: fonts.sans },
                      ]}
                    >
                      {row.idea}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            <View style={styles.pane}>
              <View style={[styles.paneHead, { borderBottomColor: c.hairline }]}>
                <Ionicons name="git-branch-outline" size={14} color={c.forest} />
                <Text
                  style={[
                    styles.paneTitle,
                    { color: c.ink, fontFamily: fonts.sansSemi },
                  ]}
                >
                  {STR.sourceMap}
                </Text>
              </View>
              <ScrollView
                style={styles.paneScroll}
                contentContainerStyle={styles.paneContent}
                showsVerticalScrollIndicator={false}
              >
                {COVERAGE_ROWS.map((row) => (
                  <View
                    key={`src-${row.id}`}
                    style={[styles.sourceCard, { borderColor: c.border }]}
                  >
                    <Text
                      style={[
                        styles.pathText,
                        { color: c.ink, fontFamily: fonts.sansSemi },
                      ]}
                      numberOfLines={2}
                    >
                      {row.sourcePath}
                    </Text>
                    <StatusChip status={row.status} mode={mode} />
                  </View>
                ))}
              </ScrollView>
            </View>
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
  sub: {
    fontSize: text.small,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[5],
    marginBottom: space[2],
    gap: space[2],
  },
  metaText: {
    fontSize: text.micro,
    flexShrink: 1,
  },
  metaSep: { fontSize: text.micro },
  counts: {
    flexDirection: "row",
    gap: space[4],
    paddingHorizontal: space[5],
    marginBottom: space[3],
  },
  count: { fontSize: text.small },
  split: {
    flex: 1,
    flexDirection: "row",
    marginHorizontal: space[4],
    marginBottom: space[5],
    borderWidth: 1,
    borderRadius: radius.card,
    overflow: "hidden",
    minHeight: 360,
  },
  pane: {
    flex: 1,
    minWidth: 0,
  },
  paneLeft: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  paneHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paneTitle: {
    fontSize: text.micro,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  paneScroll: { flex: 1 },
  paneContent: {
    padding: space[3],
    gap: space[3],
    paddingBottom: space[6],
  },
  ideaCard: {
    borderWidth: 1,
    borderRadius: radius.chip,
    padding: space[3],
  },
  ideaText: {
    fontSize: text.small,
    lineHeight: 18,
  },
  sourceCard: {
    borderWidth: 1,
    borderRadius: radius.chip,
    padding: space[3],
    gap: space[2],
  },
  pathText: {
    fontSize: text.micro,
    lineHeight: 16,
  },
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space[2],
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  chipText: { fontSize: 10 },
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
