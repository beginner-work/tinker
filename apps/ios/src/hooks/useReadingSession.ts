import { useCallback, useEffect, useRef, useState } from "react";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { extractVerbatim } from "@/src/api/learn";
import {
  askQuestion,
  createSession,
  siteDomainFromUrl,
  speakChunk,
  writeAudioCache,
  type AskResponse,
  type SessionResponse,
} from "@/src/api/reading";
import { getAnonymousDeviceId } from "@/src/lib/deviceId";
import { BANNED_VOICE_ID } from "@/src/theme/tokens";

export type ReaderStatus =
  | "idle"
  | "loading"
  | "ready"
  | "reading"
  | "paused"
  | "asking"
  | "answering"
  | "done"
  | "error";

type Options = {
  isOwner?: boolean;
};

type StartOpts = {
  /** Prefetched author from search pick — never invent client-side. */
  author?: string;
  authorSource?: string;
  authorUnknown?: boolean;
  siteName?: string;
  title?: string;
};

export function useReadingSession(opts: Options = {}) {
  const [status, setStatus] = useState<ReaderStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [essayText, setEssayText] = useState("");
  const [wordIndex, setWordIndex] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [chunkText, setChunkText] = useState("");
  const [chunkStart, setChunkStart] = useState(0);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [anonymousId, setAnonymousId] = useState("");
  const [siteDomain, setSiteDomain] = useState("");

  const playingRef = useRef(false);
  const wordIndexRef = useRef(0);
  const playerRef = useRef<AudioPlayer | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getAnonymousDeviceId().then(setAnonymousId);
    return () => {
      stopTick();
      releasePlayer();
    };
  }, []);

  const stopTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const releasePlayer = () => {
    try {
      playerRef.current?.remove();
    } catch {
      /* ignore */
    }
    playerRef.current = null;
  };

  const setWord = (n: number) => {
    wordIndexRef.current = n;
    setWordIndex(n);
  };

  const startSession = useCallback(
    async (url: string, startOpts: StartOpts = {}) => {
      setStatus("loading");
      setStatusMessage("Fetching text…");
      setAnswer(null);
      setChunkText("");
      setEssayText("");
      setWord(0);
      playingRef.current = false;
      stopTick();
      releasePlayer();
      try {
        const id = anonymousId || (await getAnonymousDeviceId());
        if (!anonymousId) setAnonymousId(id);

        // Always extract verbatim page text + author metadata server-side.
        // Never invent an author on the client.
        const extracted = await extractVerbatim(url);
        const author = String(extracted.author || startOpts.author || "").trim();
        const authorUnknown =
          extracted.authorUnknown === true ||
          startOpts.authorUnknown === true ||
          !author;

        const data = await createSession(
          {
            url: extracted.sourceUrl || url,
            verbatimText: extracted.text,
            title: extracted.title || startOpts.title || "",
            author: authorUnknown ? "" : author,
            siteName: extracted.siteName || startOpts.siteName || "",
            authorSource:
              extracted.authorSource || startOpts.authorSource || (author ? "extract" : "none"),
            authorUnknown,
          },
          {
            anonymousId: id,
            ...(opts.isOwner ? { owner: "1" as const } : {}),
          },
        );
        if (data.voiceId === BANNED_VOICE_ID) {
          throw new Error("Refusing banned voice id");
        }
        setSession({
          ...data,
          author: authorUnknown ? "" : author || data.author,
          authorUnknown,
          siteName: extracted.siteName || data.siteName || startOpts.siteName || "",
        });
        setEssayText(extracted.text || data.preview || "");
        setWordCount(extracted.wordCount || data.wordCount || 0);
        setSiteDomain(
          data.companyHost ||
            extracted.companyHost ||
            siteDomainFromUrl(data.sourceUrl),
        );
        setChunkText(extracted.text || data.preview || "");
        setChunkStart(0);
        setStatus("ready");
        setStatusMessage("Ready.");
        return data;
      } catch (err) {
        setStatus("error");
        setStatusMessage(err instanceof Error ? err.message : "Could not start session");
        throw err;
      }
    },
    [anonymousId, opts.isOwner],
  );

  const playBase64 = async (b64: string, contentType?: string) => {
    releasePlayer();
    if (!b64) return;
    const uri = await writeAudioCache(b64, contentType || "audio/mpeg");
    if (!uri) return;
    await new Promise<void>((resolve, reject) => {
      try {
        const player = createAudioPlayer({ uri });
        playerRef.current = player;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          try {
            player.removeListener("playbackStatusUpdate", onStatus);
          } catch {
            /* ignore */
          }
          resolve();
        };
        const onStatus = (st: { didJustFinish?: boolean }) => {
          if (st?.didJustFinish) finish();
        };
        player.addListener("playbackStatusUpdate", onStatus);
        player.play();
        const words = Math.max(1, (chunkText || "").split(/\s+/).length);
        const ms = Math.max(1200, Math.min(45000, words * 430));
        setTimeout(() => {
          if (playerRef.current === player) finish();
        }, ms);
      } catch (err) {
        reject(err);
      }
    });
  };

  const estimateLocalCursor = (from: number, to: number, durationMs: number) => {
    stopTick();
    const span = Math.max(1, to - from);
    const started = Date.now();
    tickRef.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / Math.max(400, durationMs));
      setWord(from + Math.floor(span * t));
    }, 80);
  };

  const speakNext = useCallback(async () => {
    if (!session || !playingRef.current) return;
    setStatus("reading");
    setStatusMessage("Reading…");
    try {
      const from = wordIndexRef.current;
      const data = await speakChunk(session.sessionId, from);
      setWordCount(data.wordCount || wordCount);
      setChunkText(data.chunkText || "");
      setChunkStart(data.fromWordIndex || from);
      const to = data.toWordIndex || from;
      if (data.done && !data.audio) {
        playingRef.current = false;
        stopTick();
        setWord(to);
        setStatus("done");
        setStatusMessage("Finished.");
        return;
      }
      const wordsInChunk = Math.max(1, to - (data.fromWordIndex || from));
      const durationMs = Math.max(1200, wordsInChunk * 430);
      estimateLocalCursor(data.fromWordIndex || from, to, durationMs);
      await playBase64(data.audio, data.contentType);
      stopTick();
      setWord(to);
      if (data.done) {
        playingRef.current = false;
        setStatus("done");
        setStatusMessage("Finished.");
        return;
      }
      if (playingRef.current) {
        await speakNext();
      }
    } catch (err) {
      playingRef.current = false;
      stopTick();
      setStatus("error");
      setStatusMessage(err instanceof Error ? err.message : "Speak failed");
    }
  }, [session, wordCount, chunkText]);

  const pause = useCallback(() => {
    playingRef.current = false;
    stopTick();
    try {
      playerRef.current?.pause();
    } catch {
      /* ignore */
    }
    setStatus("paused");
    setStatusMessage(`Paused at word ${wordIndexRef.current}.`);
  }, []);

  const resume = useCallback(() => {
    if (!session) return;
    playingRef.current = true;
    setStatus("reading");
    void speakNext();
  }, [session, speakNext]);

  const ask = useCallback(
    async (question: string, input: "voice" | "typed", rawTranscript?: string) => {
      if (!session) return null;
      const q = question.trim();
      if (!q) {
        setStatusMessage("Type or speak a question first.");
        return null;
      }
      pause();
      setStatus("asking");
      setStatusMessage("Thinking…");
      try {
        const id = anonymousId || (await getAnonymousDeviceId());
        const data = await askQuestion({
          sessionId: session.sessionId,
          question: q,
          input,
          wordIndex: wordIndexRef.current,
          anonymousId: id,
          rawTranscript,
          ...(opts.isOwner ? { owner: "1" as const } : {}),
        });
        setAnswer(data);
        if (typeof data.resumeWordIndex === "number") {
          setWord(data.resumeWordIndex);
        }
        setSiteDomain(data.companyHost || siteDomain || siteDomainFromUrl(data.sourceUrl));
        setStatus("answering");
        setStatusMessage(
          data.fetchedSource ? "Answered with a linked source." : "Answered from the text.",
        );
        if (data.audio) {
          await playBase64(data.audio);
        }
        return data;
      } catch (err) {
        setStatus("error");
        setStatusMessage(err instanceof Error ? err.message : "Ask failed");
        throw err;
      }
    },
    [session, anonymousId, opts.isOwner, pause, siteDomain],
  );

  const progress = wordCount > 0 ? Math.min(1, wordIndex / wordCount) : 0;

  return {
    status,
    statusMessage,
    session,
    essayText,
    wordIndex,
    wordCount,
    chunkText,
    chunkStart,
    answer,
    anonymousId,
    siteDomain,
    progress,
    startSession,
    pause,
    resume,
    ask,
    setStatusMessage,
  };
}
