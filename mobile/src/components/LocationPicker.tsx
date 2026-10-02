import { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radius, type } from "../theme";
import type React from "react";

export const PLACES = [
  { id: "cafe", label: "Cafe" },
  { id: "home", label: "Home" },
  { id: "work", label: "Work" },
  { id: "other", label: "Somewhere else" },
] as const;

export type PlaceId = (typeof PLACES)[number]["id"];

type Props = {
  placeId: PlaceId;
  customSeed: string;
  onChangePlace: (id: PlaceId) => void;
  onChangeCustomSeed: (value: string) => void;
};

/** Compact location control — native <select> on web, modal menu on iOS. */
export function LocationPicker({
  placeId,
  customSeed,
  onChangePlace,
  onChangeCustomSeed,
}: Props) {
  const [open, setOpen] = useState(false);
  const label = useMemo(() => {
    if (placeId === "other" && customSeed.trim()) return customSeed.trim();
    return PLACES.find((p) => p.id === placeId)?.label || "Cafe";
  }, [placeId, customSeed]);

  return (
    <View style={styles.wrap}>
      {Platform.OS === "web" ? (
        <View style={styles.trigger}>
          {(() => {
            const Select = "select" as unknown as React.ElementType;
            const Option = "option" as unknown as React.ElementType;
            return (
              <Select
                aria-label="Location"
                value={placeId}
                onChange={(e: { target: { value: string } }) =>
                  onChangePlace(e.target.value as PlaceId)
                }
                style={webSelectStyle}
              >
                {PLACES.map((place) => (
                  <Option key={place.id} value={place.id}>
                    {place.label}
                  </Option>
                ))}
              </Select>
            );
          })()}
        </View>
      ) : (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Location"
          style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        >
          <Text style={styles.triggerText} numberOfLines={1}>
            {label}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.muted} />
        </Pressable>
      )}

      {placeId === "other" ? (
        <TextInput
          style={styles.otherInput}
          value={customSeed}
          onChangeText={onChangeCustomSeed}
          placeholder="Where are you?"
          placeholderTextColor={colors.muted}
          maxLength={120}
        />
      ) : null}

      {Platform.OS !== "web" ? (
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.backdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close"
            />
            <View style={styles.menu}>
              {PLACES.map((place) => {
                const selected = place.id === placeId;
                return (
                  <Pressable
                    key={place.id}
                    onPress={() => {
                      onChangePlace(place.id);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      selected && styles.optionSelected,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        selected && styles.optionTextSelected,
                      ]}
                    >
                      {place.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export function seedFromPlace(placeId: PlaceId, customSeed: string): string {
  if (placeId === "other") {
    const custom = customSeed.trim();
    return custom || "Somewhere else";
  }
  return PLACES.find((p) => p.id === placeId)?.label || "Cafe";
}

const webSelectStyle = {
  appearance: "none" as const,
  WebkitAppearance: "none" as const,
  border: "none",
  background: "transparent",
  fontFamily: "InstrumentSans_500Medium, system-ui, sans-serif",
  fontSize: 14,
  color: colors.foreground,
  paddingRight: 18,
  paddingVertical: 2,
  cursor: "pointer",
  outline: "none",
  maxWidth: "100%",
};

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minWidth: 0,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.chip,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  triggerText: {
    flexShrink: 1,
    fontFamily: fonts.sansMedium,
    fontSize: type.body,
    color: colors.foreground,
  },
  otherInput: {
    marginTop: 8,
    fontFamily: fonts.sans,
    fontSize: type.body,
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(45, 42, 38, 0.28)",
    justifyContent: "flex-start",
    paddingTop: 96,
    paddingHorizontal: 24,
  },
  menu: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
    zIndex: 2,
  },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optionSelected: {
    backgroundColor: colors.accentDim,
  },
  optionText: {
    fontFamily: fonts.sansMedium,
    fontSize: type.base,
    color: colors.foreground,
  },
  optionTextSelected: {
    color: colors.accentStrong,
  },
  pressed: {
    opacity: 0.85,
  },
});
