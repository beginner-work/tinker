import React from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../src/auth/AuthContext";
import { colors } from "../src/theme";

export default function Index() {
  const { signedIn } = useAuth();
  if (signedIn === null) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
  return <Redirect href={signedIn ? "/home" : "/sign-in"} />;
}
