import React, { useRef, useState } from "react";
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

/* Phone → PIN, same two steps as the web gate (src/renderer/auth.js). */
export default function SignIn() {
  const { requestCode, verifyCode } = useAuth();
  const [step, setStep] = useState<"phone" | "pin">("phone");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const phoneId = useRef("");

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
      router.replace("/home");
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
          {step === "phone" ? "A quiet place to be on the web." : "Check your phone."}
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
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            autoFocus
            maxLength={6}
            onSubmitEditing={submitPin}
          />
        )}

        {status ? <Text style={styles.status}>{status}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          disabled={busy}
          onPress={step === "phone" ? submitPhone : submitPin}
        >
          <Text style={styles.buttonText}>
            {busy ? "One moment…" : step === "phone" ? "Text me a code" : "Sign in"}
          </Text>
        </Pressable>

        {step === "pin" ? (
          <Pressable onPress={() => { setStep("phone"); setPin(""); setStatus(""); }}>
            <Text style={styles.back}>Use a different number</Text>
          </Pressable>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  brand: {
    fontFamily: fonts.display,
    fontSize: type.display,
    color: colors.foreground,
    marginBottom: 24,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: type.displayLg,
    lineHeight: type.displayLg * 1.1,
    color: colors.foreground,
    marginBottom: 12,
  },
  lede: {
    fontFamily: fonts.sans,
    fontSize: type.base,
    lineHeight: type.base * 1.55,
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
    marginBottom: 12,
  },
  status: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.foreground,
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.chip,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  button: {
    backgroundColor: colors.accentStrong,
    borderRadius: radius.button,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: { backgroundColor: colors.accentPress },
  buttonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: type.base,
    color: colors.surface,
  },
  back: {
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.muted,
    textAlign: "center",
    marginTop: 16,
  },
});
