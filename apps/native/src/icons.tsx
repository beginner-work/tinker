import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

type IonName = ComponentProps<typeof Ionicons>["name"];

/**
 * Tab icons aligned with View 1 nav close-up:
 * Home house · Feed document · Explore compass · Progress activity wave.
 */
export const TAB_ICONS = {
  home: { outline: "home-outline", filled: "home" },
  feed: { outline: "document-text-outline", filled: "document-text" },
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
