import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function ConnectPhone() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("My Phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    const base = url.trim();
    if (!base) {
      setError("Enter your phone's Droid-MCP URL.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.createConnection(base, token.trim(), label.trim() || "My Phone");
      if (res.status === "connected" && res.connection_id) {
        await storage.setItem("connectionId", res.connection_id);
        await storage.setItem("connectionLabel", res.label || "My Phone");
        router.back();
      } else {
        setError(res.error || "Could not reach the phone. Check the URL, token, and that the server is running.");
      }
    } catch {
      setError("Connection failed. Check the URL and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await storage.removeItem("connectionId");
    await storage.removeItem("connectionLabel");
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="back-button" style={styles.back}>
            <Text style={styles.backText}>‹ BACK</Text>
          </Pressable>
        </View>

        <Text style={styles.title}>CONNECT PHONE</Text>
        <Text style={styles.subtitle}>
          Link your Android device running the Droid-MCP server. The URL must be reachable from the
          internet (use a public tunnel if it is on your local network).
        </Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>DROID-MCP URL</Text>
          <TextInput
            style={styles.input}
            placeholder="https://your-phone.example.com/mcp"
            placeholderTextColor={colors.muted}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="url-input"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>BEARER TOKEN</Text>
          <TextInput
            style={styles.input}
            placeholder="token from the Droid-MCP app"
            placeholderTextColor={colors.muted}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            testID="token-input"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>LABEL</Text>
          <TextInput
            style={styles.input}
            placeholder="My Phone"
            placeholderTextColor={colors.muted}
            value={label}
            onChangeText={setLabel}
            testID="label-input"
          />
        </View>

        {error && (
          <Text style={styles.error} testID="connect-error">
            {error}
          </Text>
        )}

        <Pressable style={styles.connectBtn} onPress={connect} disabled={busy} testID="connect-button">
          {busy ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.connectText}>CONNECT & TEST</Text>
          )}
        </Pressable>

        <Pressable style={styles.disconnectBtn} onPress={disconnect} testID="disconnect-button">
          <Text style={styles.disconnectText}>DISCONNECT PHONE</Text>
        </Pressable>

        <View style={styles.account}>
          <Text style={styles.accountLabel}>SIGNED IN AS</Text>
          <Text style={styles.accountEmail} testID="account-email">
            {user?.email || "—"}
          </Text>
          <Pressable style={styles.signOutBtn} onPress={signOut} testID="signout-button">
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: { flexDirection: "row" },
  back: { paddingVertical: spacing.xs },
  backText: { fontFamily: fonts.monoBold, fontSize: 13, letterSpacing: 1, color: colors.brand },
  title: { fontFamily: fonts.displayBold, fontSize: 28, letterSpacing: 2, color: colors.onSurface },
  subtitle: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, color: colors.onSurfaceTertiary },
  field: { gap: spacing.sm },
  fieldLabel: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 1.5, color: colors.muted },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.onSurface,
    fontFamily: fonts.mono,
    fontSize: 14,
    backgroundColor: colors.surfaceSecondary,
  },
  error: { fontFamily: fonts.mono, fontSize: 13, color: colors.error, lineHeight: 18 },
  connectBtn: {
    height: 54,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandPrimary,
    marginTop: spacing.sm,
  },
  connectText: { fontFamily: fonts.monoBold, fontSize: 15, letterSpacing: 2, color: colors.onBrandPrimary },
  disconnectBtn: { height: 48, alignItems: "center", justifyContent: "center" },
  disconnectText: { fontFamily: fonts.monoBold, fontSize: 12, letterSpacing: 1, color: colors.muted },
  account: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  accountLabel: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 1.5, color: colors.muted },
  accountEmail: { fontFamily: fonts.mono, fontSize: 14, color: colors.onSurface },
  signOutBtn: {
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  signOutText: { fontFamily: fonts.monoBold, fontSize: 13, letterSpacing: 2, color: colors.error },
}));
