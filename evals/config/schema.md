# Config schema

## `manifest.json`

```json
{
  "version": "v0",
  "kind": "baseline",
  "agentModeling": false,
  "notes": "Public baseline: Jev + Claude, no agent modeling.",
  "files": {
    "jevDepthScore": "jev-depth-score.json",
    "jevSourceNoul": "jev-source-noul.json",
    "claudeZpdBand": "claude-zpd-band.json",
    "claudeSourcePick": "claude-source-pick.json"
  }
}
```

## Jev Score (`jev-depth-score.json`)

```json
{
  "type": "score",
  "instructions": "How deep is the learner's understanding of: {{conceptTitle}}?",
  "criteria": ["level 0 description", "level 1", "..."]
}
```

`instructions` may include `{{conceptTitle}}`.

## Jev Noul (`jev-source-noul.json`)

```json
{
  "type": "noul",
  "instructions": "... {{sourceTitle}} ...",
  "criteria": { "true": "...", "false": "..." },
  "threshold": 0.55
}
```

## Claude templates

```json
{
  "system": "...",
  "userTemplate": "Concept: {{conceptId}}\nHistory:\n{{history}}\nBand:"
}
```

Allowed placeholders depend on the task (`conceptId`, `history`, `statement`,
`sourceList`).
