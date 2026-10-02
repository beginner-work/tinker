import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  connectGitHubRepo,
  getGitHubConfig,
  repoLabel,
  type GitHubConfig,
} from "../src/lib/github";
import { colors, fonts, radius, type } from "../src/theme";
import { TinkerGlass } from "../src/components/TinkerGlass";

/**
 * Connect a GitHub repo before writing. Essays publish as pull requests
 * into this repository.
 */
export default function ConnectRepoScreen() {
  const params = useLocalSearchParams<{
    next?: string;
    seed?: string;
    mode?: string;
  }>();
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");
  const [pathTemplate, setPathTemplate] = useState("essays/{slug}.md");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<GitHubConfig | null>(null);

  useEffect(() => {
    getGitHubConfig().then((c) => {
      if (c) {
        setExisting(c);
        setRepo(`${c.owner}/${c.repo}`);
        setPathTemplate(c.pathTemplate || "essays/{slug}.md");
      }
    });
  }, []);

  function continueAfterConnect() {
    const seed = params.seed;
    const mode = params.mode || "ai";
    const next = params.next;
    if (next === "freewrite" || ((next === "write" || seed) && mode === "noai")) {
      router.replace({
        pathname: "/freewrite",
        params: seed ? { seed } : {},
      });
      return;
    }
    if (next === "write" || seed) {
      router.replace({
        pathname: "/write",
        params: seed ? { seed } : {},
      });
      return;
    }
    router.replace("/");
  }

  async function onConnect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const config = await connectGitHubRepo({
        token,
        repo,
        pathTemplate,
      });
      setExisting(config);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      continueAfterConnect();
    } catch (e: any) {
      setError(e?.message || "Couldn't connect that repo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.body}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <Text style={styles.eyebrow}>Before you write</Text>
          <Text style={styles.title}>Add a GitHub repo</Text>
          <Text style={styles.lede}>
            Every finished essay opens as a pull request in this repository —
            your words, versioned.
          </Text>

          {existing ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                Currently linked: {repoLabel(existing)}
                {existing.login ? ` · @${existing.login}` : ""}
              </Text>
            </View>
          ) : null}

          <Text style={styles.label}>Personal access token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="ghp_… or github_pat_…"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Text style={styles.hint}>
            Needs access to contents + pull requests on the target repo.{" "}
            <Text
              style={styles.link}
              onPress={() =>
                Linking.openURL(
                  "https://github.com/settings/tokens?type=beta",
                )
              }
            >
              Create a fine-grained token
            </Text>
            .
          </Text>

          <Text style={styles.label}>Repository</Text>
          <TextInput
            style={styles.input}
            value={repo}
            onChangeText={setRepo}
            placeholder="owner/repo"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Path template</Text>
          <TextInput
            style={styles.input}
            value={pathTemplate}
            onChangeText={setPathTemplate}
            placeholder="essays/{slug}.md"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Tokens: {"{slug}"} {"{id}"} {"{yyyy}"} {"{mm}"} {"{dd}"}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable onPress={onConnect} disabled={busy} style={{ marginTop: 8 }}>
            <TinkerGlass shape="capsule" style={styles.cta}>
              <Text style={styles.ctaText}>
                {busy
                  ? "Connecting…"
                  : existing
                    ? "Update & continue"
                    : "Connect repo"}
              </Text>
            </TinkerGlass>
          </Pressable>

          {existing && !token ? (
            <Pressable onPress={continueAfterConnect}>
              <Text style={styles.secondary}>Keep current repo →</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { paddingHorizontal: 24, paddingBottom: 48, paddingTop: 8 },
  back: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
    marginBottom: 20,
  },
  eyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: type.micro,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.forest,
    marginBottom: 10,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 40,
    color: colors.foreground,
    marginBottom: 10,
  },
  lede: {
    fontFamily: fonts.sans,
    fontSize: type.base,
    lineHeight: 22,
    color: colors.muted,
    marginBottom: 22,
  },
  banner: {
    backgroundColor: colors.accentDim,
    borderRadius: radius.chip,
    padding: 12,
    marginBottom: 18,
  },
  bannerText: {
    fontFamily: fonts.sansMedium,
    fontSize: type.small,
    color: colors.foreground,
  },
  label: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.small,
    color: colors.foreground,
    marginBottom: 6,
  },
  input: {
    fontFamily: fonts.sans,
    fontSize: type.base,
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.muted,
    marginBottom: 16,
    lineHeight: 18,
  },
  link: { color: colors.accentStrong },
  error: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.foreground,
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.chip,
    padding: 10,
    marginBottom: 12,
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
  secondary: {
    marginTop: 16,
    fontFamily: fonts.sansMedium,
    fontSize: type.body,
    color: colors.accentStrong,
    textAlign: "center",
  },
});
