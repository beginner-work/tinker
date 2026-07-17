import { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
import { Ionicons, UI_ICONS } from "../icons";
import {
  COVERAGE_PAGES,
  type CoverageFile,
  type CoveragePage,
  type CoverageStatus,
} from "../data/coverageSeeds";
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
  status: CoverageStatus;
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

function FileRow({
  file,
  mode,
}: {
  file: CoverageFile;
  mode: ColorMode;
}) {
  const c = colorsFor(mode);
  const aligned = file.status === "aligned";
  return (
    <View
      style={[
        styles.fileRow,
        { backgroundColor: c.background, borderColor: c.border },
      ]}
    >
      <View style={styles.fileHead}>
        <Ionicons
          name="document-outline"
          size={14}
          color={aligned ? c.accent : "#b4533c"}
        />
        <Text
          style={[styles.filePath, { color: c.ink, fontFamily: fonts.sansSemi }]}
          numberOfLines={1}
        >
          {file.path.split("/").slice(-2).join("/")}
        </Text>
        <Text
          style={[
            styles.fileStatus,
            {
              color: aligned ? c.accent : "#b4533c",
              fontFamily: fonts.sansMed,
            },
          ]}
        >
          {aligned ? STR.aligned : STR.unaligned}
        </Text>
      </View>
      <Text
        style={[styles.fileSummary, { color: c.inkMuted, fontFamily: fonts.sans }]}
      >
        {file.summary}
      </Text>
      <Text
        style={[styles.fileFullPath, { color: c.inkSoft, fontFamily: fonts.sans }]}
        numberOfLines={1}
      >
        {file.path}
      </Text>
    </View>
  );
}

/**
 * View 3 — one pitch idea per swipe → multiple code files with summaries.
 */
export function CoverageScreen({ mode, connection, onBack, onConnect }: Props) {
  const c = colorsFor(mode);
  const pitch = PITCH_OPTIONS.find((p) => p.slug === connection.pitchSlug);
  const repo = REPO_OPTIONS.find((r) => r.slug === connection.repoSlug);
  const connected = Boolean(connection.connectedAt && pitch && repo);

  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<CoveragePage>>(null);
  const pageWidth = Dimensions.get("window").width;

  const alignedCount = COVERAGE_PAGES.filter((r) => r.status === "aligned").length;
  const gapCount = COVERAGE_PAGES.length - alignedCount;
  const current = COVERAGE_PAGES[index];

  function onMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    setIndex(Math.max(0, Math.min(COVERAGE_PAGES.length - 1, next)));
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
          {STR.oneAtATime}
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
            data={COVERAGE_PAGES}
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
                    styles.card,
                    { backgroundColor: c.surface, borderColor: c.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.eyebrow,
                      { color: c.inkSoft, fontFamily: fonts.sansSemi },
                    ]}
                  >
                    {STR.yourWords}
                  </Text>
                  <Text
                    style={[
                      styles.ideaText,
                      { color: c.ink, fontFamily: fonts.displaySemi },
                    ]}
                  >
                    {item.idea}
                  </Text>
                  <StatusChip status={item.status} mode={mode} />

                  <View style={[styles.rule, { backgroundColor: c.hairline }]} />

                  <View style={styles.filesHead}>
                    <Text
                      style={[
                        styles.eyebrow,
                        { color: c.inkSoft, fontFamily: fonts.sansSemi },
                      ]}
                    >
                      {STR.codeFiles}
                    </Text>
                    <Text
                      style={[
                        styles.filesCount,
                        { color: c.inkMuted, fontFamily: fonts.sansMed },
                      ]}
                    >
                      {item.files.length} {STR.filesLabel}
                    </Text>
                  </View>

                  <ScrollView
                    style={styles.fileList}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                  >
                    {item.files.map((file) => (
                      <FileRow key={file.path + file.summary} file={file} mode={mode} />
                    ))}
                  </ScrollView>
                </View>
              </View>
            )}
          />

          <View style={styles.footer}>
            <Text
              style={[styles.pageLabel, { color: c.inkMuted, fontFamily: fonts.sansMed }]}
            >
              {index + 1} {STR.of} {COVERAGE_PAGES.length}
              {current
                ? ` · ${current.status === "aligned" ? STR.aligned : STR.unaligned}`
                : ""}
            </Text>
            <View style={styles.dots}>
              {COVERAGE_PAGES.map((row, i) => (
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
                      width: i === index ? 18 : 8,
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
  pager: { flexGrow: 1 },
  page: {
    paddingHorizontal: space[5],
    flex: 1,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space[5],
    gap: space[3],
    flex: 1,
    maxHeight: 440,
  },
  eyebrow: {
    fontSize: text.micro,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  ideaText: {
    fontSize: text.essay,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: space[1],
  },
  filesHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  filesCount: { fontSize: text.micro },
  fileList: {
    flexGrow: 0,
    maxHeight: 220,
  },
  fileRow: {
    borderWidth: 1,
    borderRadius: radius.chip,
    padding: space[3],
    marginBottom: space[2],
    gap: 4,
  },
  fileHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  filePath: {
    flex: 1,
    fontSize: text.small,
  },
  fileStatus: {
    fontSize: text.micro,
  },
  fileSummary: {
    fontSize: text.small,
    lineHeight: 18,
    paddingLeft: 22,
  },
  fileFullPath: {
    fontSize: 11,
    paddingLeft: 22,
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
    paddingTop: space[4],
    paddingBottom: space[6],
    gap: space[3],
  },
  pageLabel: { fontSize: text.small },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  dot: {
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
