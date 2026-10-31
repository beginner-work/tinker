# Ask sources

Grounding corpora for `POST /api/ask`.

Private Lindow Labs sources (prompt + corpus) live outside this public
repo. Point `TINKER_PRIVATE_DIR` at a private pack whose layout mirrors:

```
$TINKER_PRIVATE_DIR/api/_lib/ask-sources/<sourceId>/{source.json,prompt.md,corpus/*}
```

The public tree intentionally ships no private teaching corpora. Unit
tests use `tests/fixtures/private-pack/`.
