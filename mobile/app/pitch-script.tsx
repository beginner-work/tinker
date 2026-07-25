import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { AppChrome } from "../src/components/AppChrome";
import { DECK_HEADINGS, colors, fonts, radius, type } from "../src/theme";
import { TinkerGlass } from "../src/components/TinkerGlass";

/** On-camera pitch script — eleven headings mirrored from the web deck. */
export default function PitchScriptScreen() {
  return (
    <AppChrome showModeNav={false}>
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.topAction}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>Pitch script</Text>
          <Text style={styles.lede}>
            Eleven headings. Speak from your own words — this is the camera
            view.
          </Text>
          {DECK_HEADINGS.map((heading, i) => (
            <Pressable
              key={heading}
              onPress={() =>
                Haptics.selectionAsync().catch(() => {})
              }
              style={{ marginBottom: 10 }}
            >
              <TinkerGlass shape="card" style={styles.card}>
                <Text style={styles.num}>{String(i + 1).padStart(2, "0")}</Text>
                <Text style={styles.heading}>{heading}</Text>
                <Text style={styles.hint}>
                  Lines light up from your essays on web — native fill lands
                  next.
                </Text>
              </TinkerGlass>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  topAction: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
  },
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  title: {
    fontFamily: fonts.display,
    fontSize: type.display,
    color: colors.foreground,
    marginBottom: 8,
  },
  lede: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
    marginBottom: 20,
    lineHeight: 20,
  },
  card: { padding: 16 },
  num: {
    fontFamily: fonts.sansMedium,
    fontSize: type.micro,
    color: colors.accentStrong,
    marginBottom: 4,
  },
  heading: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
    marginBottom: 6,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.muted,
    lineHeight: 18,
  },
});
