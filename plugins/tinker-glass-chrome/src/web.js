const { WebPlugin } = require("@capacitor/core");

/** Web / Electron / Android no-op — Liquid Glass is iOS-native only. */
class GlassChromeWeb extends WebPlugin {
  async isAvailable() {
    return { available: false, liquidGlass: false };
  }

  async present() {
    return { presented: false };
  }

  async dismiss() {
    return { dismissed: true };
  }

  async setModeNav() {
    return { ok: true };
  }

  async setDrawerToggle() {
    return { ok: true };
  }
}

module.exports = { GlassChromeWeb };
