/**
 * WelcomeScreen — the front door, ported from #welcome in index.html.
 *   "You are a founder." / "You just need a seed to start." /
 *   "Where are you right now?"
 * Four glass location tiles reveal a text field; committing (or tapping a
 * past seed) starts a writing session anchored to that seed. The rainbow
 * corner wedge bleeds out of the top-left, flush to the bezel.
 */

import { useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EdgeWedge } from "../components/EdgeWedge";
import { RainbowLogo } from "../components/RainbowLogo";
import { GlassSurface } from "../components/GlassSurface";
import { GlassButton } from "../components/GlassButton";
import { addSeed, listSeeds, type Seed } from "../lib/seeds";
import { colors, fonts, leading, radius, space, type } from "../theme";

const TILES = [
  { key: "cafe", label: "Cafe", placeholder: "Which cafe?" },
  { key: "home", label: "Home", placeholder: "Where at home?" },
  { key: "work", label: "Work", placeholder: "Where at work?" },
  { key: "other", label: "Somewhere else", placeholder: "Where are you?" },
] as const;

export function WelcomeScreen({ onStart }: { onStart: (seed: string) => void }) {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<(typeof TILES)[number] | null>(null);
  const [value, setValue] = useState("");
  const [seeds, setSeeds] = useState<Seed[]>([]);

  useEffect(() => {
    listSeeds().then(setSeeds);
  }, []);

  async function begin(seedName: string) {
    const name = seedName.trim();
    if (!name) return;
    const next = await addSeed(name);
    setSeeds(next);
    setValue("");
    setPicked(null);
    onStart(name);
  }

  return (
    <View style={styles.root}>
      <EdgeWedge size={220} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logo}>
          <RainbowLogo size={56} />
        </View>

        <Text style={styles.question}>You are a founder.</Text>
        <Text style={styles.sub}>You just need a seed to start.</Text>
        <Text style={styles.prompt}>Where are you right now?</Text>

        <View style={styles.grid}>
          {TILES.map((tile) => {
            const active = picked?.key === tile.key;
            return (
              <TouchableOpacity
                key={tile.key}
                activeOpacity={0.85}
                onPress={() => {
                  setPicked(active ? null : tile);
                  setValue("");
                }}
                style={styles.tileWrap}
              >
                <GlassSurface
                  radius={radius.card}
                  tint={active ? "accent" : "paper"}
                  style={styles.tile}
                >
                  <Text
                    style={[styles.tileLabel, active && styles.tileLabelActive]}
                  >
                    {tile.label}
                  </Text>
                </GlassSurface>
              </TouchableOpacity>
            );
          })}
        </View>

        {picked && (
          <View style={styles.form}>
            <GlassSurface radius={radius.button} tint="paper" style={styles.inputWrap}>
              <TextInput
                value={value}
                onChangeText={setValue}
                placeholder={picked.placeholder}
                placeholderTextColor={colors.muted}
                style={styles.input}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={() => begin(value || picked.label)}
              />
            </GlassSurface>
            <GlassButton
              label="Start →"
              variant="primary"
              onPress={() => begin(value || picked.label)}
              style={styles.startBtn}
            />
          </View>
        )}

        {seeds.length > 0 && (
          <View style={styles.seedsBlock}>
            <Text style={styles.seedsHead}>Your seeds</Text>
            <View style={styles.seedsList}>
              {seeds.map((seed) => (
                <TouchableOpacity
                  key={seed.id}
                  activeOpacity={0.85}
                  onPress={() => begin(seed.name)}
                >
                  <GlassSurface radius={radius.chip} tint="paper" style={styles.seedCard}>
                    <Text style={styles.seedName}>{seed.name}</Text>
                    <Text style={styles.seedMeta}>
                      {seed.usageCount} {seed.usageCount === 1 ? "session" : "sessions"}
                    </Text>
                  </GlassSurface>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: space[6],
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  logo: { marginBottom: space[6] },
  question: {
    fontFamily: fonts.display,
    fontSize: type.displayLg,
    color: colors.foreground,
    letterSpacing: -0.6,
  },
  sub: {
    fontFamily: fonts.sans,
    fontSize: type.essay,
    color: colors.muted,
    marginTop: space[2],
  },
  prompt: {
    fontFamily: fonts.sansMedium,
    fontSize: type.base,
    color: colors.foreground,
    marginTop: space[7],
    marginBottom: space[4],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  tileWrap: { flexGrow: 1, flexBasis: "47%" },
  tile: {
    minHeight: 76,
    paddingHorizontal: space[5],
    alignItems: "flex-start",
    justifyContent: "flex-end",
    paddingVertical: space[4],
  },
  tileLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: type.base,
    color: colors.foreground,
  },
  tileLabelActive: { color: colors.accentStrong },
  form: { marginTop: space[5], gap: space[3] },
  inputWrap: { paddingHorizontal: space[2] },
  input: {
    minHeight: 48,
    paddingHorizontal: space[4],
    fontFamily: fonts.sans,
    fontSize: type.essay,
    color: colors.foreground,
  },
  startBtn: { alignSelf: "flex-start" },
  seedsBlock: { marginTop: space[8] },
  seedsHead: {
    fontFamily: fonts.sansSemi,
    fontSize: type.small,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: space[4],
  },
  seedsList: { gap: space[3] },
  seedCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[4],
    paddingHorizontal: space[5],
    minHeight: 56,
  },
  seedName: {
    fontFamily: fonts.sansMedium,
    fontSize: type.essay,
    color: colors.foreground,
  },
  seedMeta: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.muted,
  },
});
