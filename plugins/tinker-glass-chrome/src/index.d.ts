export interface GlassChromeAvailability {
  available: boolean;
  liquidGlass: boolean;
}

export interface ModeNavState {
  /** Writing mode: guided AI interview vs freewrite. */
  mode: "ai" | "noai";
  /** Device is offline — AI segment disabled, offline sliver shown. */
  offline?: boolean;
  /** Whether the mode nav should be on screen (welcome feed only). */
  visible?: boolean;
}

export interface DrawerToggleState {
  expanded?: boolean;
  visible?: boolean;
}

export interface GlassChromePlugin {
  isAvailable(): Promise<GlassChromeAvailability>;
  present(): Promise<{ presented: boolean }>;
  dismiss(): Promise<{ dismissed: boolean }>;
  setModeNav(options: ModeNavState): Promise<{ ok: boolean }>;
  setDrawerToggle(options: DrawerToggleState): Promise<{ ok: boolean }>;
  addListener(
    eventName: "drawerToggle",
    listenerFunc: () => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: "modeSelect",
    listenerFunc: (event: { mode: "ai" | "noai" }) => void,
  ): Promise<{ remove: () => void }>;
}

export declare const GlassChrome: GlassChromePlugin;
