import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
  EMPTY_CONNECTION,
  PITCH_OPTIONS,
  REPO_OPTIONS,
  type ConnectionState,
  type PitchOption,
  type RepoOption,
} from "../data/connectSeeds";
import { isMcpConfigured, listReposFromHub, pullRepoFromHub } from "../mcp/client";

type Props = {
  mode: ColorMode;
  connection: ConnectionState;
  onConnectionChange: (next: ConnectionState) => void;
  onBack: () => void;
};

function SelectRow({
  mode,
  selected,
  title,
  subtitle,
  meta,
  onPress,
}: {
  mode: ColorMode;
  selected: boolean;
  title: string;
  subtitle: string;
  meta?: string;
  onPress: () => void;
}) {
  const c = colorsFor(mode);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectRow,
        {
          backgroundColor: c.surface,
          borderColor: selected ? c.accent : c.border,
        },
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <View style={styles.selectBody}>
        <Text style={[styles.selectTitle, { color: c.ink, fontFamily: fonts.sansSemi }]}>
          {title}
        </Text>
        <Text
          style={[styles.selectSub, { color: c.inkMuted, fontFamily: fonts.sans }]}
          numberOfLines={2}
        >
          {subtitle}
        </Text>
        {meta ? (
          <Text style={[styles.selectMeta, { color: c.inkSoft, fontFamily: fonts.sansMed }]}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={22}
        color={selected ? c.accent : c.inkSoft}
      />
    </Pressable>
  );
}

/**
 * View 2 — Connect a pitch + repository (MCP hub is source of truth).
 * Connection state only — no AI-authored prose.
 */
export function ConnectScreen({
  mode,
  connection,
  onConnectionChange,
  onBack,
}: Props) {
  const c = colorsFor(mode);
  const [pitchSlug, setPitchSlug] = useState(connection.pitchSlug);
  const [repoSlug, setRepoSlug] = useState(connection.repoSlug);
  const [repos, setRepos] = useState<RepoOption[]>(REPO_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [hubLive, setHubLive] = useState(false);
  const [pulledNote, setPulledNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isMcpConfigured()) return;
      setLoading(true);
      const fromHub = await listReposFromHub();
      if (!cancelled && fromHub && fromHub.length > 0) {
        setRepos(fromHub);
        setHubLive(true);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPitch: PitchOption | undefined = useMemo(
    () => PITCH_OPTIONS.find((p) => p.slug === pitchSlug),
    [pitchSlug],
  );
  const selectedRepo: RepoOption | undefined = useMemo(
    () => repos.find((r) => r.slug === repoSlug),
    [repos, repoSlug],
  );

  const canSave = Boolean(pitchSlug && repoSlug);
  const isConnected =
    connection.pitchSlug === pitchSlug &&
    connection.repoSlug === repoSlug &&
    Boolean(connection.connectedAt);

  async function onPullAndSave() {
    if (!pitchSlug || !repoSlug) return;
    setLoading(true);
    setPulledNote(null);
    const pulled = await pullRepoFromHub(repoSlug);
    if (pulled) {
      setPulledNote(STR.manifestPulled);
      setHubLive(true);
    }
    onConnectionChange({
      pitchSlug,
      repoSlug,
      connectedAt: new Date().toISOString(),
    });
    setLoading(false);
  }

  function onClear() {
    setPitchSlug(null);
    setRepoSlug(null);
    setPulledNote(null);
    onConnectionChange(EMPTY_CONNECTION);
  }

  return (
    <View style={[styles.root, { backgroundColor: c.background }]} accessibilityLabel={STR.connect}>
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
        <Pressable
          onPress={() => {}}
          style={[styles.searchBtn, { backgroundColor: c.surface, borderColor: c.border }]}
          accessibilityLabel={STR.search}
        >
          <Ionicons name={UI_ICONS.search} size={18} color={c.ink} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: c.ink, fontFamily: fonts.display }]}>
          {STR.connect}
        </Text>
        <Text style={[styles.sub, { color: c.inkMuted, fontFamily: fonts.sans }]}>
          {STR.connectExplain}
        </Text>

        <View
          style={[
            styles.statusCard,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <View style={styles.statusRow}>
            <Ionicons
              name={isConnected ? "link" : "unlink-outline"}
              size={18}
              color={isConnected ? c.accent : c.inkSoft}
            />
            <Text
              style={[
                styles.statusLabel,
                {
                  color: isConnected ? c.accent : c.inkMuted,
                  fontFamily: fonts.sansSemi,
                },
              ]}
            >
              {isConnected ? STR.connected : STR.notConnected}
            </Text>
          </View>
          <Text style={[styles.statusMeta, { color: c.inkSoft, fontFamily: fonts.sans }]}>
            {hubLive ? STR.mcpHubLive : STR.mcpHubLocal}
          </Text>
          {pulledNote ? (
            <Text style={[styles.statusMeta, { color: c.forest, fontFamily: fonts.sansMed }]}>
              {pulledNote}
            </Text>
          ) : null}
        </View>

        <Text style={[styles.section, { color: c.ink, fontFamily: fonts.sansSemi }]}>
          {STR.pitch}
        </Text>
        <Text style={[styles.hint, { color: c.inkSoft, fontFamily: fonts.sans }]}>
          {STR.pickPitch}
        </Text>
        {PITCH_OPTIONS.length === 0 ? (
          <Text style={[styles.empty, { color: c.inkMuted, fontFamily: fonts.sans }]}>
            {STR.noPitchesYet}
          </Text>
        ) : (
          PITCH_OPTIONS.map((p) => (
            <SelectRow
              key={p.id}
              mode={mode}
              selected={pitchSlug === p.slug}
              title={p.title}
              subtitle={p.summary}
              onPress={() => setPitchSlug(p.slug)}
            />
          ))
        )}

        <Text
          style={[
            styles.section,
            { color: c.ink, fontFamily: fonts.sansSemi, marginTop: space[5] },
          ]}
        >
          {STR.repository}
        </Text>
        <Text style={[styles.hint, { color: c.inkSoft, fontFamily: fonts.sans }]}>
          {STR.pullFromMcp}
        </Text>
        {loading && repos === REPO_OPTIONS ? (
          <ActivityIndicator color={c.accent} style={{ marginVertical: space[4] }} />
        ) : null}
        {repos.length === 0 ? (
          <Text style={[styles.empty, { color: c.inkMuted, fontFamily: fonts.sans }]}>
            {STR.noReposYet}
          </Text>
        ) : (
          repos.map((r) => (
            <SelectRow
              key={r.id}
              mode={mode}
              selected={repoSlug === r.slug}
              title={r.title}
              subtitle={`${STR.installTool}: ${r.installTool}`}
              meta={r.platforms.join(" · ")}
              onPress={() => setRepoSlug(r.slug)}
            />
          ))
        )}

        {selectedPitch && selectedRepo ? (
          <View
            style={[
              styles.summaryCard,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <Text style={[styles.summaryLabel, { color: c.inkSoft, fontFamily: fonts.sansMed }]}>
              {STR.sourceOfTruth}
            </Text>
            <Text style={[styles.summaryLine, { color: c.ink, fontFamily: fonts.sansSemi }]}>
              {selectedPitch.title}
            </Text>
            <Text style={[styles.summaryLine, { color: c.inkMuted, fontFamily: fonts.sans }]}>
              {selectedRepo.slug}
            </Text>
          </View>
        ) : null}

        <Pressable
          disabled={!canSave || loading}
          onPress={onPullAndSave}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: !canSave
                ? c.border
                : pressed
                  ? c.accentPress
                  : c.accent,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={STR.saveConnection}
        >
          {loading ? (
            <ActivityIndicator color="#fffdf7" />
          ) : (
            <Text
              style={[
                styles.primaryLabel,
                {
                  color: canSave ? "#fffdf7" : c.inkSoft,
                  fontFamily: fonts.sansBold,
                },
              ]}
            >
              {STR.saveConnection}
            </Text>
          )}
        </Pressable>

        {connection.connectedAt ? (
          <Pressable
            onPress={onClear}
            style={styles.secondaryBtn}
            accessibilityRole="button"
            accessibilityLabel={STR.clearConnection}
          >
            <Text
              style={[
                styles.secondaryLabel,
                { color: c.inkMuted, fontFamily: fonts.sansMed },
              ]}
            >
              {STR.clearConnection}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
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
  scroll: {
    paddingHorizontal: space[5],
    paddingBottom: space[8],
  },
  title: {
    fontSize: text.title,
    letterSpacing: -0.5,
    marginBottom: space[2],
  },
  sub: {
    fontSize: text.small,
    marginBottom: space[5],
    lineHeight: 18,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space[4],
    marginBottom: space[6],
    gap: space[2],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  statusLabel: { fontSize: text.base },
  statusMeta: { fontSize: text.micro },
  section: {
    fontSize: text.section,
    marginBottom: space[2],
  },
  hint: {
    fontSize: text.small,
    marginBottom: space[3],
  },
  empty: {
    fontSize: text.body,
    marginBottom: space[4],
  },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderWidth: 1.5,
    borderRadius: radius.card,
    padding: space[4],
    marginBottom: space[3],
  },
  selectBody: { flex: 1, gap: 4 },
  selectTitle: { fontSize: text.base },
  selectSub: { fontSize: text.small, lineHeight: 18 },
  selectMeta: { fontSize: text.micro, marginTop: 2 },
  summaryCard: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space[4],
    marginTop: space[3],
    marginBottom: space[5],
    gap: space[2],
  },
  summaryLabel: {
    fontSize: text.micro,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  summaryLine: { fontSize: text.body },
  primaryBtn: {
    borderRadius: radius.button,
    paddingVertical: space[4],
    alignItems: "center",
    marginBottom: space[3],
  },
  primaryLabel: { fontSize: text.base },
  secondaryBtn: {
    alignItems: "center",
    paddingVertical: space[3],
  },
  secondaryLabel: { fontSize: text.small },
});
