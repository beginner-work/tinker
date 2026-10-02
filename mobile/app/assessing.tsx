import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { listEssays, retryEssayPullRequest } from "../src/lib/drafts";
import type { Essay } from "../src/api/userData";
import { colors, fonts, radius, type } from "../src/theme";
import { TinkerGlass } from "../src/components/TinkerGlass";

/** Post-publish — actions only, no framing copy. */
export default function AssessingScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    prUrl?: string;
    prError?: string;
  }>();
  const [essay, setEssay] = useState<Essay | null>(null);
  const [prUrl, setPrUrl] = useState(params.prUrl || "");
  const [prError, setPrError] = useState(params.prError || "");
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!params.id) return;
    let mounted = true;
    listEssays()
      .then((all) => {
        if (!mounted) return;
        const found = all.find((e) => e.id === params.id) || null;
        setEssay(found);
        if (found?.github?.prUrl) {
          setPrUrl(found.github.prUrl);
          setPrError("");
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [params.id]);

  async function onRetryPr() {
    if (!essay || retrying) return;
    setRetrying(true);
    setPrError("");
    try {
      const { essay: next, prError: err } = await retryEssayPullRequest(essay);
      setEssay(next);
      if (next.github?.prUrl) {
        setPrUrl(next.github.prUrl);
        setPrError("");
      } else {
        setPrError(err || "Could not open a GitHub pull request.");
      }
    } finally {
      setRetrying(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        {essay?.title ? (
          <Text style={styles.title}>{essay.title}</Text>
        ) : null}

        <Pressable
          onPress={() =>
            params.id
              ? router.replace({ pathname: "/read", params: { id: params.id } })
              : router.replace("/essays")
          }
          style={{ marginBottom: 12 }}
        >
          <Text style={styles.secondary}>Re-read your essay</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace("/")}
          style={{ marginBottom: 20 }}
        >
          <TinkerGlass shape="capsule" style={styles.cta}>
            <Text style={styles.ctaText}>Keep writing →</Text>
          </TinkerGlass>
        </Pressable>

        {prUrl ? (
          <Pressable
            onPress={() => Linking.openURL(prUrl)}
            style={{ marginBottom: 12 }}
          >
            <Text style={styles.secondary}>
              Open PR
              {essay?.github?.prNumber ? ` #${essay.github.prNumber}` : ""} →
            </Text>
          </Pressable>
        ) : prError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{prError}</Text>
            {essay ? (
              <Pressable onPress={onRetryPr} disabled={retrying}>
                <Text style={styles.retry}>
                  {retrying ? "Opening PR…" : "Retry pull request →"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
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
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 34,
    color: colors.foreground,
    marginBottom: 24,
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
  errorBox: {
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.chip,
    padding: 12,
    marginTop: 8,
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.foreground,
    lineHeight: 18,
    marginBottom: 8,
  },
  retry: {
    fontFamily: fonts.sansMedium,
    fontSize: type.body,
    color: colors.accentStrong,
  },
  secondary: {
    fontFamily: fonts.sansMedium,
    fontSize: type.body,
    color: colors.accentStrong,
    textAlign: "center",
    paddingVertical: 10,
  },
});
