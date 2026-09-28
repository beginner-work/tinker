import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { listEssays, retryEssayPullRequest } from "../src/lib/drafts";
import type { Essay } from "../src/api/userData";
import { colors, fonts, radius, type } from "../src/theme";
import { TinkerGlass } from "../src/components/TinkerGlass";

/** Post-publish confirmation — essay saved, PR opened (or retryable). */
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
        <Text style={styles.eyebrow}>Published</Text>
        <Text style={styles.title}>Your writing is being assessed.</Text>
        <Text style={styles.lede}>
          We&apos;ll place it where it fits. A pull request carries the words
          into your GitHub repo.
        </Text>

        {prUrl ? (
          <Pressable
            onPress={() => Linking.openURL(prUrl)}
            style={{ marginBottom: 12 }}
          >
            <TinkerGlass shape="capsule" style={styles.cta}>
              <Text style={styles.ctaText}>
                Open PR
                {essay?.github?.prNumber ? ` #${essay.github.prNumber}` : ""} →
              </Text>
            </TinkerGlass>
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

        <Pressable
          onPress={() => router.replace("/")}
          style={{ marginBottom: 12 }}
        >
          <TinkerGlass shape="capsule" style={styles.ctaSecondary}>
            <Text style={styles.ctaText}>Keep writing</Text>
          </TinkerGlass>
        </Pressable>

        {params.id ? (
          <Pressable
            onPress={() =>
              router.replace({ pathname: "/read", params: { id: params.id } })
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
  ctaSecondary: {
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
    marginBottom: 16,
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
