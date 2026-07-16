import { Pressable, StyleSheet, Text, View } from "react-native";
import { colorsFor, fonts, radius, space, text, type ColorMode } from "../theme";
import { STR } from "../strings";

type Props = {
  onContinue: () => void;
  mode: ColorMode;
};

/**
 * View 1 — first open: a quote from themselves (pitch reflections / writings).
 * Tinker type: Fraunces display + Instrument Sans UI.
 */
export function FirstOpenScreen({ onContinue, mode }: Props) {
  const c = colorsFor(mode);
  return (
    <View
      style={[styles.root, { backgroundColor: c.background }]}
      accessibilityLabel={STR.yourWords}
    >
      <View style={styles.rainbow} />
      <Text style={[styles.brand, { color: c.ink, fontFamily: fonts.display }]}>
        {STR.brand}
      </Text>
      <Text
        style={[
          styles.eyebrow,
          { color: c.inkSoft, fontFamily: fonts.sansSemi },
        ]}
      >
        {STR.yourWords}
      </Text>
      <Text
        style={[styles.quote, { color: c.ink, fontFamily: fonts.displaySemi }]}
      >
        {STR.pitchProblem}
      </Text>
      <Text
        style={[styles.tagline, { color: c.forest, fontFamily: fonts.sansMed }]}
      >
        {STR.pitchTagline}
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: pressed ? c.accentPress : c.accent,
          },
        ]}
        onPress={onContinue}
        accessibilityRole="button"
        accessibilityLabel={STR.continueLabel}
      >
        <Text
          style={[
            styles.buttonLabel,
            { color: mode === "dark" ? c.background : "#fffdf7", fontFamily: fonts.sansBold },
          ]}
        >
          {STR.continueLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: space[6],
    paddingTop: space[8] + 24,
    paddingBottom: space[8],
    justifyContent: "center",
  },
  rainbow: {
    position: "absolute",
    top: 56,
    left: space[6],
    right: space[6],
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: "#c8b6e2",
  },
  brand: {
    fontSize: text.display,
    letterSpacing: -0.4,
    marginBottom: space[7],
  },
  eyebrow: {
    fontSize: text.micro,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: space[4],
  },
  quote: {
    fontSize: text.displayLg,
    lineHeight: 42,
    marginBottom: space[6],
  },
  tagline: {
    fontSize: text.essay,
    marginBottom: space[8],
  },
  button: {
    alignSelf: "flex-start",
    paddingVertical: space[4],
    paddingHorizontal: space[6],
    borderRadius: radius.button,
  },
  buttonLabel: {
    fontSize: text.base,
  },
});
