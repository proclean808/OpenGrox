import { QueryClientProvider } from "@tanstack/react-query";
import * as Device from "expo-device";
import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, LogBox, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/src/auth";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { AUTH_ENABLED } from "@/src/config";
import { queryClient } from "@/src/query-client";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL as string;

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync().catch(() => {});

// Push: foreground display behavior (module scope, native only).
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
// Push: Android channel (module scope).
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  }).catch(() => {});
}

async function registerForPush(userId: string) {
  if (Platform.OS === "web" || !Device.isDevice) return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await fetch(`${BACKEND}/api/register-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, platform: Platform.OS, device_token: tokenResp.data }),
    });
  } catch {
    // Expo Go has no FCM/APNs — this only works in a dev/prod build. Safe to ignore here.
  }
}

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!AUTH_ENABLED) return; // devops bypass — no forced login
    const onLogin = segments[0] === "login";
    if (!user && !onLogin) router.replace("/login");
    else if (user && onLogin) router.replace("/");
  }, [user, loading, segments, router]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    registerForPush(user?.user_id || "devops");

    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data || {}) as Record<string, string>;
      const url = data.deeplink || data.action_url;
      if (url) (url.startsWith("http") ? Linking.openURL(url) : router.push(url as never));
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = (response.notification.request.content.data || {}) as Record<string, string>;
      const url = data.deeplink || data.action_url;
      if (url) (url.startsWith("http") ? Linking.openURL(url) : router.push(url as never));
    });
    return () => tapSub.remove();
  }, [user?.user_id, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#090B0D", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#00FF66" />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#090B0D" } }} />;
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Rajdhani: require("../assets/fonts/Rajdhani-Medium.ttf"),
    "Rajdhani-SemiBold": require("../assets/fonts/Rajdhani-SemiBold.ttf"),
    "Rajdhani-Bold": require("../assets/fonts/Rajdhani-Bold.ttf"),
    JetBrainsMono: require("../assets/fonts/JetBrainsMono-Regular.ttf"),
    "JetBrainsMono-Medium": require("../assets/fonts/JetBrainsMono-Medium.ttf"),
    "JetBrainsMono-Bold": require("../assets/fonts/JetBrainsMono-Bold.ttf"),
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) return <View style={{ flex: 1, backgroundColor: "#090B0D" }} />;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#090B0D" }}>
          <SafeAreaProvider>
            <KeyboardProvider>
              <AuthProvider>
                <StatusBar style="light" />
                <AuthGate />
              </AuthProvider>
            </KeyboardProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
