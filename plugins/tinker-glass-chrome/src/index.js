const { registerPlugin } = require("@capacitor/core");

const GlassChrome = registerPlugin("GlassChrome", {
  web: () => import("./web").then((m) => new m.GlassChromeWeb()),
});

module.exports = { GlassChrome };
