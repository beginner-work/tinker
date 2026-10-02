import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TinkerGlass } from "./TinkerGlass";
import { colors } from "../theme";

type Props = {
  onPress: () => void;
  hidden?: boolean;
};

export function DrawerToggle({ onPress, hidden }: Props) {
  const insets = useSafeAreaInsets();
  if (hidden) return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open sidebar"
      style={[styles.wrap, { top: Math.max(insets.top, 8) + 4 }]}
    >
      <TinkerGlass shape="circle" glassStyle="regular" style={styles.glass}>
        <Ionicons name="menu" size={22} color={colors.foreground} />
      </TinkerGlass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    zIndex: 40,
  },
  glass: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
