import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { TinkerGlass, TinkerGlassGroup } from "./TinkerGlass";
import { colors, space } from "../theme";
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
  selectedId?: string | null;
};

export function WelcomeBody({ mode, onPickPlace, selectedId }: Props) {
  return (
    <View style={styles.body}>
      {/* Atmospheric planes so Liquid Glass has color to refract */}
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
      <LinearGradient
        colors={["rgba(99,102,241,0.18)", "transparent"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 0.6 }}
        style={styles.haze}
      />
      <LinearGradient
        colors={["transparent", "rgba(253,186,116,0.22)"]}
        start={{ x: 0.5, y: 0.35 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.floor}
      />

      <Text style={styles.eyebrow}>tinker</Text>
      <Text style={styles.headline}>You are a founder.</Text>
      <Text style={styles.lede}>
        Pick a place to start writing
        {mode === "noai"
          ? " — No AI mode is on."
          : " — with a guided interview."}
      </Text>

      <TinkerGlassGroup style={styles.grid} spacing={10}>
        {PLACES.map((place) => {
          const selected = selectedId === place.id;
          return (
            <TinkerGlass
              key={place.id}
              shape="card"
              glassStyle={selected ? "clear" : "regular"}
              isInteractive
              animate
              style={styles.cardGlass}
            >
              <Pressable
                onPress={() => onPickPlace(place.id)}
                accessibilityRole="button"
                accessibilityLabel={place.label}
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.cardPress,
                  pressed && styles.cardPressed,
                ]}
              >
                <Text style={styles.cardLabel}>{place.label}</Text>
                {selected ? (
                  <Text style={styles.cardHint}>selected</Text>
                ) : null}
              </Pressable>
            </TinkerGlass>
          );
        })}
      </TinkerGlassGroup>
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
    width: 220,
    height: 220,
    opacity: 0.7,
    borderBottomRightRadius: 220,
  },
  haze: {
    position: "absolute",
    top: 40,
    right: -40,
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  floor: {
    ...StyleSheet.absoluteFill,
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
  cardGlass: {
    width: "47%",
    minWidth: 140,
    flexGrow: 1,
    minHeight: 88,
  },
  cardPress: {
    flex: 1,
    paddingVertical: space[6],
    paddingHorizontal: space[5],
    justifyContent: "center",
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardLabel: {
    fontFamily: "InstrumentSans_500Medium",
    fontSize: 15,
    color: colors.foreground,
  },
  cardHint: {
    marginTop: 4,
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.accentStrong,
  },
});
