# tinker native (Expo / iOS)

Native iOS shell for the product-oriented development feed — a GitHub
alternative where founders explore progress against pitch, without sharing
source in the feed. Spec: [`../../build-prompts/product-oriented-dev-feed.md`](../../build-prompts/product-oriented-dev-feed.md).

## Views (current)

1. **First open** — quote from pitch / writings  
2. **Explore** — GitHub-shaped Discover + Activity + floating pill nav  
3. **Connect** — pick a pitch + pull a repository (MCP hub source of truth)

Fonts: **Fraunces** + **Instrument Sans**. Light default; Dark toggle.

Optional live hub:

```bash
export EXPO_PUBLIC_MCP_URL="https://beginner-mcp.<sub>.workers.dev"
export EXPO_PUBLIC_MCP_BEARER_TOKEN="…"
```

Without those, Connect uses local seed repos with the same manifest shape.

## Run

```bash
cd apps/native
npm install
npm run ios      # macOS + Xcode / Expo Go (Gemma later needs a dev client)
npm run web      # review / screenshots on non-macOS agents
```

## Later views

Coverage (on-device Gemma) → live progress feed.  
Each view pauses for Cursor screenshot/video review before the next.
