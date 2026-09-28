import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { TinkerGlass, TinkerGlassGroup } from "./TinkerGlass";
import { colors, space } from "../theme";

const PLACES = [
  { id: "cafe", label: "Cafe" },
  { id: "home", label: "Home" },
  { id: "work", label: "Work" },
  { id: "other", label: "Somewhere else" },
] as const;

type Props = {
  onPickPlace: (id: string, customSeed?: string) => void;
  selectedId?: string | null;
};

/** Welcome copy matches src/renderer/index.html verbatim. */
export function WelcomeBody({ onPickPlace, selectedId }: Props) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");

  function onTile(id: string) {
    if (id === "other") {
      setOtherOpen(true);
      return;
    }
    setOtherOpen(false);
    onPickPlace(id);
  }

  function onStartOther() {
    const seed = otherText.trim();
    if (!seed) return;
    onPickPlace("other", seed);
  }

  return (
    <View style={styles.body}>
      {/* Atmospheric planes so Liquid Glass has color to refract.
       * pointerEvents none — these must never steal taps from cards. */}
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
        pointerEvents="none"
      />
      <LinearGradient
        colors={["rgba(99,102,241,0.18)", "transparent"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 0.6 }}
        style={styles.haze}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["transparent", "rgba(253,186,116,0.22)"]}
        start={{ x: 0.5, y: 0.35 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.floor}
        pointerEvents="none"
      />

      <Text style={styles.headline}>You are a founder.</Text>
      <Text style={styles.lede}>You just need a seed to start.</Text>
      <Text style={styles.prompt}>Where are you right now?</Text>

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
                onPress={() => onTile(place.id)}
                accessibilityRole="button"
                accessibilityLabel={place.label}
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.cardPress,
                  pressed && styles.cardPressed,
                ]}
              >
                <Text style={styles.cardLabel}>{place.label}</Text>
              </Pressable>
            </TinkerGlass>
          );
        })}
      </TinkerGlassGroup>

      {otherOpen ? (
        <View style={styles.otherForm}>
          <TextInput
            style={styles.otherInput}
            value={otherText}
            onChangeText={setOtherText}
            placeholder="Where are you?"
            placeholderTextColor={colors.muted}
            maxLength={120}
            autoFocus
            onSubmitEditing={onStartOther}
          />
          <Pressable
            onPress={onStartOther}
            disabled={!otherText.trim()}
            style={({ pressed }) => [
              styles.otherSubmit,
              pressed && styles.cardPressed,
              !otherText.trim() && styles.otherSubmitDisabled,
            ]}
          >
            <Text style={styles.otherSubmitText}>Start →</Text>
          </Pressable>
        </View>
      ) : null}
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
    marginBottom: space[3],
    maxWidth: 320,
  },
  prompt: {
    fontFamily: "InstrumentSans_500Medium",
    fontSize: 15,
    lineHeight: 22,
    color: colors.foreground,
    marginBottom: space[5],
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
  otherForm: {
    marginTop: space[5],
    gap: space[3],
  },
  otherInput: {
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 16,
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  otherSubmit: {
    alignSelf: "flex-start",
    backgroundColor: colors.accentStrong,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  otherSubmitDisabled: {
    opacity: 0.45,
  },
  otherSubmitText: {
    fontFamily: "InstrumentSans_600SemiBold",
    fontSize: 15,
    color: colors.surface,
  },
});
