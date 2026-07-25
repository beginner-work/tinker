import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TinkerGlass } from "./TinkerGlass";
import { colors, space } from "../theme";

type Props = {
  open: boolean;
  onClose: () => void;
};

const LINKS = [
  "Cafe",
  "Home",
  "Work",
  "Somewhere else",
  "Pitches",
  "Wallet",
];

export function SidebarDrawer({ open, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(width * 0.82, 320);

  return (
    <Modal
      visible={open}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close sidebar"
        />
        <View
          style={[
            styles.panelWrap,
            {
              width: panelWidth,
              paddingTop: insets.top + space[4],
              paddingBottom: insets.bottom + space[5],
            },
          ]}
        >
          <TinkerGlass
            shape="sheet"
            glassStyle="regular"
            isInteractive={false}
            style={styles.panelGlass}
          >
            <Text style={styles.brand}>tinker</Text>
            <Text style={styles.tag}>a quiet place to be on the web</Text>
            <View style={styles.list}>
              {LINKS.map((label) => (
                <Pressable
                  key={label}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={onClose}
                  accessibilityRole="button"
                >
                  <Text style={styles.rowText}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.note}>
              Expo Go preview — native Liquid Glass chrome. Full product stays
              in the Capacitor / web app for now.
            </Text>
          </TinkerGlass>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(45, 42, 38, 0.28)",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  panelWrap: {
    height: "100%",
    paddingLeft: space[3],
    paddingRight: space[2],
    zIndex: 2,
  },
  panelGlass: {
    flex: 1,
    paddingHorizontal: space[5],
    paddingTop: space[5],
    paddingBottom: space[5],
  },
  brand: {
    fontFamily: "Fraunces_500Medium",
    fontSize: 28,
    color: colors.foreground,
    letterSpacing: -0.4,
  },
  tag: {
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    marginBottom: space[6],
  },
  list: {
    gap: 2,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  rowPressed: {
    backgroundColor: "rgba(99, 102, 241, 0.12)",
  },
  rowText: {
    fontFamily: "InstrumentSans_500Medium",
    fontSize: 15,
    color: colors.foreground,
  },
  note: {
    marginTop: "auto",
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
});
