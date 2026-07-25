import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { colors, fonts, radius, type } from "../src/theme";
import { TinkerGlass } from "../src/components/TinkerGlass";

/** Post-publish "being assessed" confirmation. */
export default function AssessingScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>Published</Text>
        <Text style={styles.title}>Your writing is being assessed.</Text>
        <Text style={styles.lede}>
          We&apos;ll place it where it fits. Keep writing, or read what you just
          made.
        </Text>

        <Pressable
          onPress={() => router.replace("/")}
          style={{ marginBottom: 12 }}
        >
          <TinkerGlass shape="capsule" style={styles.cta}>
            <Text style={styles.ctaText}>Keep writing</Text>
          </TinkerGlass>
        </Pressable>

        {id ? (
          <Pressable
            onPress={() =>
              router.replace({ pathname: "/read", params: { id } })
            }
          >
            <Text style={styles.secondary}>Read essay →</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={() => router.replace("/essays")}>
          <Text style={styles.secondary}>All essays</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "center",
  },
  eyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: type.micro,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.forest,
    marginBottom: 12,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 40,
    color: colors.foreground,
    marginBottom: 12,
  },
  lede: {
    fontFamily: fonts.sans,
    fontSize: type.base,
    lineHeight: 22,
    color: colors.muted,
    marginBottom: 28,
  },
  cta: {
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  ctaText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
  },
  secondary: {
    fontFamily: fonts.sansMedium,
    fontSize: type.body,
    color: colors.accentStrong,
    textAlign: "center",
    paddingVertical: 10,
  },
});
