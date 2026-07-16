# tinker native (Expo / iOS)

Native iOS shell for the product-oriented development feed — a GitHub
alternative where founders explore progress against pitch, without sharing
source in the feed. Spec: [`../../build-prompts/product-oriented-dev-feed.md`](../../build-prompts/product-oriented-dev-feed.md).

## View 1 (current)

- GitHub mobile Explore–shaped layout (Discover + Activity + floating pill nav)
- Fonts: **Fraunces** (display) + **Instrument Sans** (UI) — tinker design system
- Light default to match Explore reference; Dark remains a toggle
- First open: a quote from the founder's own pitch / writings
- Progress / coverage activity — **no source code** in the feed

## Run

```bash
cd apps/native
npm install
npm run ios      # macOS + Xcode / Expo Go (Gemma later needs a dev client)
npm run web      # review / screenshots on non-macOS agents
```

## Later views

Connect repo/pitch → coverage (on-device Gemma) → live progress feed → MCP hub.
Each view pauses for Cursor screenshot/video review before the next.
