# tinker native (Expo / iOS)

Native iOS shell for the product-oriented development feed — a GitHub
alternative where founders explore progress against pitch, without sharing
source in the feed. Spec: [`../../build-prompts/product-oriented-dev-feed.md`](../../build-prompts/product-oriented-dev-feed.md).

## View 1 (current)

- Dark mode first
- First open: a quote from the founder's own pitch / writings
- LinkedIn-style progress feed shell (no source code)

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
