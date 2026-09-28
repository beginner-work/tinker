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
import { colors, fonts, space, type } from "../theme";

type Props = {
  open: boolean;
  onClose: () => void;
  signedIn?: boolean;
  onSignOut?: () => void;
  onNavigate?: (route: string) => void;
};

const LINKS: { label: string; route: string }[] = [
  { label: "Home", route: "/" },
  { label: "Write (AI)", route: "/write" },
  { label: "No AI", route: "/freewrite" },
  { label: "Essays", route: "/essays" },
  { label: "GitHub repo", route: "/connect-repo" },
  { label: "Pitch script", route: "/pitch-script" },
  { label: "Find founders", route: "/founders" },
  { label: "Profile", route: "/profile" },
];

export function SidebarDrawer({
  open,
  onClose,
  signedIn,
  onSignOut,
  onNavigate,
}: Props) {
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
              {LINKS.map((item) => (
                <Pressable
                  key={item.route}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() => onNavigate?.(item.route)}
                  accessibilityRole="button"
                >
                  <Text style={styles.rowText}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            {signedIn ? (
              <Pressable
                style={styles.signOut}
                onPress={onSignOut}
                accessibilityRole="button"
              >
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.signOut}
                onPress={() => onNavigate?.("/sign-in")}
                accessibilityRole="button"
              >
                <Text style={styles.signOutText}>Sign in</Text>
              </Pressable>
            )}
            <Text style={styles.note}>
              Native Expo shell — Liquid Glass chrome + writing surfaces.
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
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.foreground,
    letterSpacing: -0.4,
  },
  tag: {
    fontFamily: fonts.sans,
    fontSize: type.small,
    color: colors.muted,
    marginTop: 4,
    marginBottom: space[6],
  },
  list: { gap: 2 },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  rowPressed: {
    backgroundColor: "rgba(99, 102, 241, 0.12)",
  },
  rowText: {
    fontFamily: fonts.sansMedium,
    fontSize: type.base,
    color: colors.foreground,
  },
  signOut: {
    marginTop: space[4],
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  signOutText: {
    fontFamily: fonts.sansMedium,
    fontSize: type.body,
    color: colors.accentStrong,
  },
  note: {
    marginTop: "auto",
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
});
