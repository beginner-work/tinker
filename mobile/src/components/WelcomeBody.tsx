import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radii, space } from "../theme";
import type { WritingMode } from "./ModeNav";

const PLACES = [
  { id: "cafe", label: "Cafe" },
  { id: "home", label: "Home" },
  { id: "work", label: "Work" },
  { id: "other", label: "Somewhere else" },
] as const;

type Props = {
  mode: WritingMode;
  onPickPlace: (id: string) => void;
};

export function WelcomeBody({ mode, onPickPlace }: Props) {
  return (
    <View style={styles.body}>
      <LinearGradient
        colors={[
          colors.logoPink,
          colors.logoOrange,
          colors.logoYellow,
          colors.logoLeaf,
          colors.logoMint,
          colors.logoSky,
          colors.logoPurple,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.wedge}
      />

      <Text style={styles.eyebrow}>tinker</Text>
      <Text style={styles.headline}>You are a founder.</Text>
      <Text style={styles.lede}>
        Pick a place to start writing
        {mode === "noai" ? " — No AI mode is on." : " — with a guided interview."}
      </Text>

      <View style={styles.grid}>
        {PLACES.map((place) => (
          <Pressable
            key={place.id}
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
            onPress={() => onPickPlace(place.id)}
            accessibilityRole="button"
            accessibilityLabel={place.label}
          >
            <Text style={styles.cardLabel}>{place.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: space[6],
    paddingTop: 72,
    justifyContent: "center",
  },
  wedge: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 180,
    height: 180,
    opacity: 0.55,
    // Approximate the welcome corner triangle feel
    borderBottomRightRadius: 180,
  },
  eyebrow: {
    fontFamily: "InstrumentSans_500Medium",
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: space[3],
  },
  headline: {
    fontFamily: "Fraunces_500Medium",
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.8,
    color: colors.foreground,
    marginBottom: space[3],
  },
  lede: {
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
    marginBottom: space[7],
    maxWidth: 320,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  card: {
    width: "47%",
    minWidth: 140,
    flexGrow: 1,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingVertical: space[6],
    paddingHorizontal: space[5],
  },
  cardPressed: {
    borderColor: colors.accentStrong,
  },
  cardLabel: {
    fontFamily: "InstrumentSans_500Medium",
    fontSize: 15,
    color: colors.foreground,
  },
});
