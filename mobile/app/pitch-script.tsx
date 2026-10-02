import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { AppChrome } from "../src/components/AppChrome";
import { DECK_HEADINGS, colors, fonts, type } from "../src/theme";
import { TinkerGlass } from "../src/components/TinkerGlass";

export default function PitchScriptScreen() {
  const [copied, setCopied] = useState(false);

  function onCopy() {
    setCopied(true);
    Haptics.selectionAsync().catch(() => {});
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <AppChrome showModeNav={false}>
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.topAction}>Back</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {DECK_HEADINGS.map((heading, i) => (
            <Pressable
              key={heading}
              onPress={() => Haptics.selectionAsync().catch(() => {})}
              style={{ marginBottom: 10 }}
            >
              <TinkerGlass shape="card" style={styles.card}>
                <Text style={styles.num}>
                  {String(i + 1).padStart(2, "0")}
                </Text>
                <Text style={styles.heading}>{heading}</Text>
              </TinkerGlass>
            </Pressable>
          ))}
          <Pressable onPress={onCopy} style={{ marginTop: 12 }}>
            <TinkerGlass shape="capsule" style={styles.copyBtn}>
              <Text style={styles.copyText}>
                {copied ? "Copied" : "Copy script"}
              </Text>
            </TinkerGlass>
          </Pressable>
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
  },
  copyBtn: {
    alignItems: "center",
    paddingVertical: 14,
  },
  copyText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
  },
});
