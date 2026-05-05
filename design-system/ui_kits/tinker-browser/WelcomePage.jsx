/* WelcomePage.jsx — the home view. One title, one search field. */

function WelcomePage({ onSubmit }) {
  const [value, setValue] = React.useState("");
  return (
    <section className="welcome" data-active>
      <div className="welcome__inner">
        <h1 className="welcome__title">A new way to web</h1>
        <form
          className="welcome__search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const v = value.trim();
            if (!v) return;
            setValue("");
            onSubmit(v);
          }}
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Start a new web"
            aria-label="Start a new web"
            autoComplete="off"
            spellCheck="false"
          />
          <button type="submit" className="welcome__begin">Begin</button>
        </form>
      </div>
    </section>
  );
}

window.WelcomePage = WelcomePage;
