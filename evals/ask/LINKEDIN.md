# LinkedIn export → private Braintrust dataset

Loader: `scripts/load-linkedin-messages.js`  
Logic: `evals/ask/lib/linkedin-messages.js`  
Synthetic fixture (only in-repo CSV): `evals/ask/fixtures/linkedin-messages.synthetic.csv`

## What it does

1. Reads LinkedIn's official data-export `messages.csv`.
2. Groups by `CONVERSATION ID`, sorts by `DATE`.
3. For each **inbound** message (not from Tyler), finds **Tyler's next reply**.
4. Rewrites the inbound `CONTENT` into a generic `question` (strips the other
   person's name, their company, emails, phones, URLs).
5. Keeps Tyler's reply as `tyler_answer` with `source: "linkedin"`.
6. With `--upload`, inserts rows into a **private** Braintrust dataset
   (`tinker-ask` / `linkedin-replies-private` by default).

## Do / don't

- **Do** test with `npm run eval:ask:linkedin:fixture`.
- **Don't** commit any real export (`messages.csv`, `Basic_LinkedInDataExport*`).
- **Don't** run the loader on real data from this agent/CI yet.
- **Don't** write `--out` inside the git work tree (the CLI refuses).

## Real export (Tyler, later)

```bash
# Export lives outside the repo, e.g. ~/Downloads/Basic_LinkedInDataExport_.../messages.csv
BRAINTRUST_API_KEY=… node scripts/load-linkedin-messages.js \
  --csv "$HOME/Downloads/Basic_LinkedInDataExport_xxx/messages.csv" \
  --allow-real \
  --upload
```

Requires repo secret `BRAINTRUST_API_KEY`. Dataset metadata sets
`visibility: "private"`; Braintrust datasets are org-scoped (not public links).
