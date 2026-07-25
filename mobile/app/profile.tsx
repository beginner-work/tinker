import { useCallback, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { AppChrome } from "../src/components/AppChrome";
import { useAuth } from "../src/auth/AuthContext";
import { colors, fonts, radius, type } from "../src/theme";
import { TinkerGlass } from "../src/components/TinkerGlass";
import { API_BASE } from "../src/api/client";
import {
  clearGitHubConnection,
  getGitHubConfig,
  repoLabel,
  type GitHubConfig,
} from "../src/lib/github";

const LINKS = [
  {
    label: "Wallet",
    href: "https://www.beginner.work/wallet",
    blurb: "Receive deposited beginner backer cards.",
  },
  {
    label: "Back me",
    href: "https://www.beginner.work/tyler-lindow#share",
    blurb: "Open your beginner profile share sheet.",
  },
  {
    label: "Open beginner",
    href: "https://www.beginner.work/",
    blurb: "The public surface next door.",
  },
];

export default function ProfileScreen() {
  const { signedIn, signOut } = useAuth();
  const [github, setGithub] = useState<GitHubConfig | null>(null);

  useFocusEffect(
    useCallback(() => {
      getGitHubConfig().then(setGithub).catch(() => setGithub(null));
    }, []),
  );

  return (
    <AppChrome showModeNav={false}>
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <View style={styles.body}>
          <Text style={styles.title}>Account</Text>
          <Text style={styles.lede}>
            {signedIn
              ? "Signed in. Essays publish as pull requests into your linked GitHub repo."
              : "Sign in to sync drafts and essays with the web app."}
          </Text>

          <Text style={styles.meta}>API {API_BASE}</Text>

          <Text style={styles.section}>GitHub repo</Text>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>
              {github ? repoLabel(github) : "Not connected"}
            </Text>
            <Text style={styles.rowBlurb}>
              {github
                ? `Writings land under ${github.pathTemplate}${
                    github.login ? ` · @${github.login}` : ""
                  }`
                : "Connect a repo before writing — every essay opens a PR."}
            </Text>
            <Pressable
              onPress={() => router.push("/connect-repo")}
              style={{ marginTop: 10 }}
            >
              <Text style={styles.link}>
                {github ? "Change repo →" : "Connect repo →"}
              </Text>
            </Pressable>
            {github ? (
              <Pressable
                onPress={async () => {
                  await clearGitHubConnection();
                  setGithub(null);
                }}
                style={{ marginTop: 8 }}
              >
                <Text style={styles.disconnect}>Disconnect</Text>
              </Pressable>
            ) : null}
          </View>

          {!signedIn ? (
            <Pressable
              onPress={() => router.push("/sign-in")}
              style={{ marginBottom: 12 }}
            >
              <TinkerGlass shape="capsule" style={styles.cta}>
                <Text style={styles.ctaText}>Sign in</Text>
              </TinkerGlass>
            </Pressable>
          ) : (
            <Pressable
              onPress={async () => {
                await signOut();
                router.replace("/sign-in");
              }}
              style={{ marginBottom: 12 }}
            >
              <TinkerGlass shape="capsule" style={styles.cta}>
                <Text style={styles.ctaText}>Sign out</Text>
              </TinkerGlass>
            </Pressable>
          )}

          {LINKS.map((item) => (
            <Pressable
              key={item.href}
              style={styles.row}
              onPress={() => Linking.openURL(item.href)}
            >
              <Text style={styles.rowTitle}>{item.label}</Text>
              <Text style={styles.rowBlurb}>{item.blurb}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </AppChrome>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 56 },
  body: { flex: 1, paddingHorizontal: 24 },
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
    lineHeight: 20,
    marginBottom: 12,
  },
  meta: {
    fontFamily: fonts.sans,
    fontSize: type.micro,
    color: colors.muted,
    marginBottom: 20,
  },
  section: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.small,
    color: colors.foreground,
    marginBottom: 8,
  },
  cta: {
    alignItems: "center",
    paddingVertical: 14,
  },
  ctaText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 10,
  },
  rowTitle: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
    marginBottom: 4,
  },
  rowBlurb: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.muted,
  },
  link: {
    fontFamily: fonts.sansMedium,
    fontSize: type.body,
    color: colors.accentStrong,
  },
  disconnect: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.muted,
  },
});
