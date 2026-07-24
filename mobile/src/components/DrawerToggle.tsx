import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TinkerGlass } from "./TinkerGlass";
import { colors } from "../theme";

type Props = {
  onPress: () => void;
  hidden?: boolean;
};

export function DrawerToggle({ onPress, hidden }: Props) {
  if (hidden) return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open sidebar"
      style={styles.wrap}
    >
      <TinkerGlass shape="circle" style={styles.glass}>
        <Ionicons name="menu" size={22} color={colors.foreground} />
      </TinkerGlass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 12,
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
