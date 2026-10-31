import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { colors, fonts, space } from "@/src/theme/tokens";

type Props = {
  visible: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (question: string, input: "voice" | "typed", raw?: string) => void;
};

export function AskPanel({ visible, busy, onClose, onSubmit }: Props) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const fromVoiceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const avail = await ExpoSpeechRecognitionModule.isRecognitionAvailable();
        if (!cancelled) setVoiceSupported(Boolean(avail));
      } catch {
        if (!cancelled) setVoiceSupported(Platform.OS === "web");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results?.[0]?.transcript || "";
    if (transcript) {
      fromVoiceRef.current = true;
      setText(transcript);
    }
  });

  useSpeechRecognitionEvent("end", () => setListening(false));
  useSpeechRecognitionEvent("error", () => setListening(false));

  const startVoice = useCallback(async () => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) return;
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: false,
      });
    } catch {
      setListening(false);
      const g = globalThis as unknown as {
        webkitSpeechRecognition?: new () => WebSpeechRec;
        SpeechRecognition?: new () => WebSpeechRec;
      };
      const Ctor = g.SpeechRecognition || g.webkitSpeechRecognition;
      if (!Ctor) return;
      const rec = new Ctor();
      rec.lang = "en-US";
      setListening(true);
      rec.onresult = (e) => {
        const t = e.results?.[0]?.[0]?.transcript || "";
        if (t) {
          fromVoiceRef.current = true;
          setText(t);
        }
      };
      rec.onend = () => setListening(false);
      rec.start();
    }
  }, []);

  const stopVoice = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  if (!visible) return null;

  return (
    <View style={styles.panel} accessibilityViewIsModal>
      <View style={styles.header}>
        <Text style={styles.label}>Interrupt</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Ask anything about this text. Answers stay grounded in what you are reading.
      </Text>
      <TextInput
        style={styles.input}
        multiline
        value={text}
        onChangeText={(v) => {
          fromVoiceRef.current = false;
          setText(v);
        }}
        placeholder="What does this mean?"
        placeholderTextColor={colors.muted}
        editable={!busy}
        accessibilityLabel="Question"
      />
      <View style={styles.row}>
        {voiceSupported ? (
          <Pressable
            style={[styles.btn, styles.ghost, listening && styles.listening]}
            onPress={listening ? stopVoice : startVoice}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={listening ? "Stop listening" : "Ask by voice"}
          >
            <Text style={styles.ghostText}>{listening ? "Listening…" : "Voice"}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.btn, styles.primary, busy && styles.disabled]}
          onPress={() => {
            const q = text.trim();
            if (!q || busy) return;
            const input = fromVoiceRef.current ? "voice" : "typed";
            onSubmit(q, input, fromVoiceRef.current ? q : undefined);
            setText("");
            fromVoiceRef.current = false;
          }}
          disabled={busy || !text.trim()}
          accessibilityRole="button"
          accessibilityLabel="Ask question"
        >
          {busy ? (
            <ActivityIndicator color="#f7fff9" />
          ) : (
            <Text style={styles.primaryText}>Ask</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

type WebSpeechRec = {
  lang: string;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const styles = StyleSheet.create({
  panel: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space[4],
    gap: space[3],
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
  },
  close: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.accent,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.cream,
    textAlignVertical: "top",
  },
  row: {
    flexDirection: "row",
    gap: space[3],
    alignItems: "center",
  },
  btn: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 88,
  },
  primary: {
    backgroundColor: colors.accent,
    flex: 1,
  },
  primaryText: {
    fontFamily: fonts.bodySemi,
    color: "#f7fff9",
    fontSize: 15,
  },
  ghost: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "transparent",
  },
  ghostText: {
    fontFamily: fonts.bodySemi,
    color: colors.ink,
    fontSize: 15,
  },
  listening: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  disabled: {
    opacity: 0.45,
  },
});
