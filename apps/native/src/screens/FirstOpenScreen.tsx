import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { STR } from "../strings";

type Props = {
  onContinue: () => void;
};

/**
 * View 1 — first open: a quote from themselves (pitch reflections / writings).
 * Dark mode. Welcoming and grounded.
 */
export function FirstOpenScreen({ onContinue }: Props) {
  return (
    <View style={styles.root} accessibilityLabel={STR.yourWords}>
      <View style={styles.rainbow} />
      <Text style={styles.brand}>{STR.brand}</Text>
      <Text style={styles.eyebrow}>{STR.yourWords}</Text>
      <Text style={styles.quote}>{STR.pitchProblem}</Text>
      <Text style={styles.tagline}>{STR.pitchTagline}</Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onContinue}
        accessibilityRole="button"
        accessibilityLabel={STR.continueLabel}
      >
        <Text style={styles.buttonLabel}>{STR.continueLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.space.6,
    paddingTop: theme.space.8 + 24,
    paddingBottom: theme.space.8,
    justifyContent: "center",
  },
  rainbow: {
    position: "absolute",
    top: 56,
    left: theme.space.6,
    right: theme.space.6,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.violet,
  },
  brand: {
    fontFamily: theme.fonts.display,
    fontSize: theme.text.display,
    fontWeight: "700",
    color: theme.colors.ink,
    letterSpacing: -0.4,
    marginBottom: theme.space.7,
  },
  eyebrow: {
    fontSize: theme.text.micro,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: theme.colors.inkSoft,
    marginBottom: theme.space.4,
  },
  quote: {
    fontFamily: theme.fonts.display,
    fontSize: theme.text.displayLg,
    lineHeight: 42,
    fontWeight: "600",
    color: theme.colors.ink,
    marginBottom: theme.space.6,
  },
  tagline: {
    fontSize: theme.text.essay,
    color: theme.colors.forest,
    marginBottom: theme.space.8,
  },
  button: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.accent,
    paddingVertical: theme.space.4,
    paddingHorizontal: theme.space.6,
    borderRadius: theme.radius.button,
  },
  buttonPressed: {
    backgroundColor: theme.colors.accentPress,
  },
  buttonLabel: {
    color: theme.colors.background,
    fontSize: theme.text.base,
    fontWeight: "700",
  },
});
