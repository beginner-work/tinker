/* Dictation hook over expo-speech-recognition.
 *
 * On-device first: Android uses Google's on-device SpeechRecognizer
 * (offline model, downloaded on first use), iOS uses SFSpeechRecognizer
 * with requiresOnDeviceRecognition. If the on-device engine declines to
 * start (model missing, unsupported locale), we retry once without the
 * on-device requirement so dictation still works — the founder's words
 * matter more than the transport.
 */

import { useCallback, useRef, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

export type DictationState = {
  listening: boolean;
  /** Live partial transcript for the in-flight utterance. */
  partial: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
};

export function useDictation(onFinal: (text: string) => void): DictationState {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const triedFallback = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useSpeechRecognitionEvent("start", () => {
    setListening(true);
    setError(null);
  });

  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    setPartial("");
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results?.[0]?.transcript ?? "";
    if (event.isFinal) {
      setPartial("");
      if (transcript.trim()) onFinalRef.current(transcript.trim());
    } else {
      setPartial(transcript);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    setPartial("");
    // "language-not-supported" / "service-not-allowed" from the
    // on-device engine → one retry over the default (network) engine.
    if (!triedFallback.current && event.error !== "not-allowed") {
      triedFallback.current = true;
      begin(false).catch(() => setError("Dictation isn't available right now."));
      return;
    }
    setError(
      event.error === "not-allowed"
        ? "Microphone access is off — enable it in Settings."
        : "Dictation isn't available right now.",
    );
  });

  const begin = useCallback(async (onDevice: boolean) => {
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: onDevice,
      addsPunctuation: true,
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);
    triedFallback.current = false;
    const perms = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perms.granted) {
      setError("Microphone access is off — enable it in Settings.");
      return;
    }
    await begin(true);
  }, [begin]);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return { listening, partial, error, start, stop };
}
