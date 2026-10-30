# `@tinker/sdk`

Embed Tinker voice ask on any site. The package is publishable as
`@tinker/sdk` but stays private in this repo (do not publish to npm).

Two surfaces:

1. **Server client** (`@tinker/sdk/server`) — holds `TINKER_SERVICE_TOKEN`,
   calls `POST /api/transcribe` and `POST /api/ask`.
2. **Browser Ask pill** (`@tinker/sdk/browser`) — floating Tinker-logo
   pill. Talks only to your origin via `proxyUrl` so tokens never reach
   the browser.

## Install (workspace)

```bash
npm install --prefix packages/tinker-sdk
npm run build --prefix packages/tinker-sdk
```

From an app in the same monorepo:

```ts
import { TinkerClient } from "@tinker/sdk/server";
import { TinkerAsk } from "@tinker/sdk/browser";
```

## Server client

```ts
import { createTinkerClient } from "@tinker/sdk/server";

const tinker = createTinkerClient({
  baseUrl: "https://tinker.beginner.work",
  serviceToken: process.env.TINKER_SERVICE_TOKEN!,
  caller: "mysite.com", // X-Tinker-Caller
});

// multipart audio → { text, words, durationMs, requestId }
const transcript = await tinker.transcribe({
  audio: buffer,
  mimeType: "audio/webm",
});

// grounded spoken answer → { answerText, audio (base64 mp3), requestId, latencyMs }
const answer = await tinker.ask({
  question: transcript.text,
  input: "voice",
  rawTranscript: transcript.text,
  sourceId: "lindowlabs-minds-and-models",
  position: { wordIndex: 120, paragraph: 3 },
});
```

### `TinkerClient` API

| Method | Args | Returns |
| --- | --- | --- |
| `createTinkerClient(options)` / `new TinkerClient(options)` | `{ baseUrl?, serviceToken, caller?, fetch? }` | client |
| `client.transcribe({ audio, mimeType, fieldName?, filename? })` | audio bytes + MIME | `TranscribeResult` |
| `client.ask({ question, input, sourceId, rawTranscript?, position?, context? })` | ask body | `AskResult` |

## Browser Ask pill

```ts
import { TinkerAsk } from "@tinker/sdk/browser";

const ask = TinkerAsk.create({
  proxyUrl: "/api/tinker", // host routes /transcribe + /ask
  sourceId: "lindowlabs-minds-and-models",
  audioElement: "#homepage-talk", // narration <audio> to pause
  defaultMode: "voice",
  getPosition: () => ({ wordIndex: currentWord, paragraph: currentPara }),
  onPause: () => player.pause(),
  onResume: () => player.play(),
  onTranscript: ({ text, editedText }) => console.log(text, editedText),
  onAnswer: ({ answerText, requestId }) => console.log(answerText),
  onError: (err) => console.warn(err.message),
});

// ask.open(); ask.close(); ask.destroy();
```

The pill POSTs to:

- `${proxyUrl}/transcribe` — multipart `audio`
- `${proxyUrl}/ask` — JSON ask body

Override with `transcribeUrl` / `askUrl` if your routes differ.

### `TinkerAsk.create` options

| Option | Purpose |
| --- | --- |
| `proxyUrl` | Host proxy base (required) |
| `sourceId` | Grounding corpus id (required) |
| `audioElement` | Narration `<audio>` element or selector |
| `defaultMode` | `"voice"` or `"typed"` |
| `headers` | Extra proxy headers (object or thunk) |
| `getPosition` | Talk interrupt position |
| `onPause` / `onResume` | Narration hooks |
| `onTranscript` / `onAnswer` / `onError` / `onStateChange` | Events |

### Handle

`open`, `close`, `startVoice`, `stopVoice`, `submit`, `destroy`,
`getState`, `getTranscript`, `setTranscript`.

## Example host

```bash
npm run build --prefix packages/tinker-sdk
TINKER_SERVICE_TOKEN=… node packages/tinker-sdk/examples/basic-host/server.mjs
# open http://localhost:8787
```

`examples/basic-host/server.mjs` uses `TinkerClient`. The HTML page is a
bundler-free typed demo of the same proxy contract; wire `TinkerAsk`
into your real frontend bundler for the full pill UI.

## Tests

```bash
npm test --prefix packages/tinker-sdk
```

## Security

- Never put `TINKER_SERVICE_TOKEN`, `ANTHROPIC_API_KEY`, or
  `ELEVENLABS_API_KEY` in client JS.
- Browser code only receives `proxyUrl` on your origin.
- Label callers with `X-Tinker-Caller` via the server client `caller` option.
