/* SearchPane.jsx — the result pane. Three states: loading, ready, error. */

const SAMPLE_ESSAY_BY_QUERY = {
  default:
    "There's a lot to say about that, and most of it depends on where you're coming from. The plain version is this: people who've been doing it longest tend to start with the [Wikipedia overview](https://en.wikipedia.org/wiki/Main_Page) — not because it's authoritative, but because it's a calm map of the territory.\n\nIf you want to read the people who actually do the work, the [LRB](https://www.lrb.co.uk) and [The Atlantic](https://www.theatlantic.com) both run long-form pieces that hold up. They're slower than headlines, and they should be.\n\nFor anything official, government and standards bodies — [.gov](https://www.usa.gov) directories, [W3C](https://www.w3.org), the [Library of Congress](https://www.loc.gov) — are still the most reliable sources on the open web. They don't try to sell you anything.\n\nThe last thing worth saying: take your time. The shape of an answer matters more than its speed.",
};

function ThinkingDots() {
  return (
    <span className="thinking-dots" aria-hidden="true">
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
    </span>
  );
}

function renderEssay(markdown) {
  // tiny renderer mirroring src/renderer/renderer.js
  const escape = (s) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const linked = escape(markdown).replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  const bolded = linked.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const italic = bolded.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return italic
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>").trim()}</p>`)
    .filter((p) => p !== "<p></p>")
    .join("");
}

function SearchPane({ query, state, message }) {
  return (
    <section className="search-pane" data-active>
      <div className="search-pane__inner">
        <div className="search-pane__header">
          <span className="search-pane__crumb">Search</span>
          <h2 className="search-pane__query">{query}</h2>
        </div>
        <div className="search-pane__body">
          {state === "loading" && (
            <div className="search-pane__loading">
              <ThinkingDots />
              <span>Reading the room…</span>
            </div>
          )}
          {state === "ready" && (
            <article
              className="search-pane__essay"
              dangerouslySetInnerHTML={{ __html: renderEssay(SAMPLE_ESSAY_BY_QUERY.default) }}
            />
          )}
          {state === "error" && (
            <div className="search-pane__error">
              <p><strong>The search couldn't finish.</strong></p>
              <p>{message || "Unknown error"}</p>
              <p className="search-pane__error-hint">
                Make sure <code>ANTHROPIC_API_KEY</code> is set in your environment, then restart tinker.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

window.SearchPane = SearchPane;
