import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  SafeAreaView,
} from "react-native";
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
  return (
    <Modal
      visible={open}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <SafeAreaView style={styles.panel}>
          <Text style={styles.brand}>tinker</Text>
          <Text style={styles.tag}>a quiet place to be on the web</Text>
          <View style={styles.list}>
            {LINKS.map((label) => (
              <Pressable
                key={label}
                style={styles.row}
                onPress={onClose}
                accessibilityRole="button"
              >
                <Text style={styles.rowText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>
            Expo Go preview — glass chrome only. Full product stays in the
            Capacitor / web app for now.
          </Text>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  panel: {
    width: "82%",
    maxWidth: 320,
    height: "100%",
    backgroundColor: colors.background,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    paddingHorizontal: space[5],
    paddingTop: space[4],
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
  rowText: {
    fontFamily: "InstrumentSans_500Medium",
    fontSize: 15,
    color: colors.foreground,
  },
  note: {
    marginTop: "auto",
    marginBottom: space[5],
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
});
