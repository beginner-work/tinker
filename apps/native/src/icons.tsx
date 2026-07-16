import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

type IonName = ComponentProps<typeof Ionicons>["name"];

/** Tab + Discover icon names — Ionicons, GitHub Explore–adjacent, no letter glyphs. */
export const TAB_ICONS = {
  home: { outline: "home-outline", filled: "home" },
  feed: { outline: "newspaper-outline", filled: "newspaper" },
  explore: { outline: "compass-outline", filled: "compass" },
  progress: { outline: "pulse-outline", filled: "pulse" },
} as const satisfies Record<string, { outline: IonName; filled: IonName }>;

export const DISCOVER_ICONS = {
  coverage: "checkmark-done-outline",
  connect: "link-outline",
  progress: "trending-up-outline",
} as const satisfies Record<string, IonName>;

export const UI_ICONS = {
  search: "search-outline",
  chevron: "chevron-forward",
  filter: "funnel-outline",
} as const satisfies Record<string, IonName>;

export { Ionicons };
