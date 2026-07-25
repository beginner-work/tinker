import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { DrawerToggle } from "./DrawerToggle";
import { ModeNav, WritingMode } from "./ModeNav";
import { SidebarDrawer } from "./SidebarDrawer";
import { useAuth } from "../auth/AuthContext";

type Props = {
  children: React.ReactNode;
  mode?: WritingMode;
  onModeChange?: (mode: WritingMode) => void;
  showModeNav?: boolean;
  showDrawerToggle?: boolean;
};

/**
 * Floating Liquid Glass chrome shared across native screens.
 */
export function AppChrome({
  children,
  mode = "ai",
  onModeChange,
  showModeNav = true,
  showDrawerToggle = true,
}: Props) {
  const { signedIn, signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleMode = useCallback(
    (next: WritingMode) => {
      onModeChange?.(next);
      if (next === "noai") router.push("/freewrite");
    },
    [onModeChange],
  );

  return (
    <View style={styles.root}>
      {children}

      {showDrawerToggle ? (
        <DrawerToggle
          hidden={drawerOpen}
          onPress={() => setDrawerOpen(true)}
        />
      ) : null}

      {showModeNav ? (
        <ModeNav
          mode={mode}
          visible={!drawerOpen}
          onChange={handleMode}
        />
      ) : null}

      <SidebarDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        signedIn={!!signedIn}
        onSignOut={async () => {
          setDrawerOpen(false);
          await signOut();
          router.replace("/sign-in");
        }}
        onNavigate={(route) => {
          setDrawerOpen(false);
          router.push(route as any);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
