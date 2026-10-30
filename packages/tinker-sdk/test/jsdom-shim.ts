/* Tiny JSDOM-compatible facade so browser tests don't need a full browser.
 * Prefer the real `jsdom` package when installed; otherwise fall back to a
 * minimal document stub sufficient for mount/open/submit assertions.
 */

export type JSDOMOptions = { url?: string };

export class JSDOM {
  window: Window & {
    document: Document;
    close: () => void;
  };

  constructor(html: string, _options?: JSDOMOptions) {
    // Lazy-require so unit environments without jsdom can still load the file
    // when only server tests run. Browser tests need jsdom installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let RealJSDOM: new (html: string, opts?: JSDOMOptions) => {
      window: Window & { close: () => void };
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      RealJSDOM = require("jsdom").JSDOM;
    } catch {
      throw new Error(
        "jsdom is required for browser Ask pill tests. Run npm install in packages/tinker-sdk.",
      );
    }
    const dom = new RealJSDOM(html, _options);
    this.window = dom.window as Window & { document: Document; close: () => void };
  }
}
