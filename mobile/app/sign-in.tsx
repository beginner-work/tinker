import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "../src/auth/AuthContext";
import { colors, fonts, radius, type } from "../src/theme";
import { TinkerGlass } from "../src/components/TinkerGlass";

export default function SignIn() {
  const { requestCode, verifyCode, signedIn } = useAuth();
  const [step, setStep] = useState<"phone" | "pin">("phone");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const phoneId = useRef("");

  useEffect(() => {
    if (signedIn) router.replace("/");
  }, [signedIn]);

  async function submitPhone() {
    if (busy || !phone.trim()) return;
    setBusy(true);
    setStatus("");
    try {
      const r = await requestCode(phone.trim());
      phoneId.current = r.phoneId;
      setStep("pin");
    } catch (e: any) {
      setStatus(e?.message || "Couldn't send the code — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPin() {
    if (busy || !pin.trim()) return;
    setBusy(true);
    setStatus("");
    try {
      await verifyCode(phoneId.current, pin.trim());
      router.replace("/");
    } catch (e: any) {
      setStatus(e?.message || "That code didn't match — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Text style={styles.brand}>tinker</Text>
        <Text style={styles.title}>
          {step === "phone"
            ? "A quiet place to be on the web."
            : "Check your phone."}
        </Text>
        <Text style={styles.lede}>
          {step === "phone"
            ? "Sign in with your phone number — we'll text you a code."
            : `We sent a code to ${phone}.`}
        </Text>

        {step === "phone" ? (
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Your phone number"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            autoComplete="tel"
            autoFocus
            onSubmitEditing={submitPhone}
          />
        ) : (
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={setPin}
            placeholder="6-digit code"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            onSubmitEditing={submitPin}
          />
        )}

        {status ? <Text style={styles.status}>{status}</Text> : null}

        <Pressable
          onPress={step === "phone" ? submitPhone : submitPin}
          disabled={busy}
        >
          <TinkerGlass shape="capsule" style={styles.cta}>
            <Text style={styles.ctaText}>
              {busy
                ? "…"
                : step === "phone"
                  ? "Send code"
                  : "Sign in"}
            </Text>
          </TinkerGlass>
        </Pressable>

        {step === "pin" ? (
          <Pressable onPress={() => setStep("phone")}>
            <Text style={styles.back}>← Different number</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, paddingHorizontal: 28, paddingTop: 48, justifyContent: "center" },
  brand: {
    fontFamily: fonts.sansMedium,
    fontSize: type.micro,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: 12,
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
    marginBottom: 28,
  },
  input: {
    fontFamily: fonts.sans,
    fontSize: type.essay,
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
  },
  status: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.foreground,
    backgroundColor: colors.errorBg,
    borderColor: colors.errorBorder,
    borderWidth: 1,
    borderRadius: radius.chip,
    padding: 10,
    marginBottom: 12,
  },
  cta: {
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  ctaText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.foreground,
  },
  back: {
    marginTop: 18,
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
    textAlign: "center",
  },
});
