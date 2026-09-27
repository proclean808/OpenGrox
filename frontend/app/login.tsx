import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1649962843028-54905316eb21?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzd8MHwxfHNlYXJjaHwyfHxzY2klMjBmaSUyMGRhcmslMjB0ZXh0dXJlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3OTA1MDg5NzR8MA&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signingIn } = useAuth();

  return (
    <View style={styles.root}>
      <Image source={{ uri: HERO }} style={styles.hero} contentFit="cover" transition={300} />
      <LinearGradient colors={["rgba(9,11,13,0.4)", "rgba(9,11,13,0.9)", colors.surface]} style={styles.scrim} />

      <View style={[styles.content, { paddingTop: insets.top + spacing.xxxl, paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.brandBlock}>
          <View style={styles.orbMark}>
            <View style={[styles.orbCore, { borderColor: colors.brand }]} />
          </View>
          <Text style={styles.title}>OPENGROX</Text>
          <Text style={styles.subtitle}>COMMAND DROID</Text>
          <Text style={styles.tagline}>Talk to your AI. It operates your phone.</Text>
        </View>

        <View style={styles.footer}>
          <Pressable style={styles.googleBtn} onPress={signIn} disabled={signingIn} testID="google-signin-button">
            {signingIn ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.googleText}>SIGN IN WITH GOOGLE</Text>
            )}
          </Pressable>
          <Text style={styles.legal}>Secure sign-in · your session lasts 7 days</Text>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.55 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  content: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: "space-between" },
  brandBlock: { alignItems: "center", gap: spacing.sm, marginTop: spacing.xxxl },
  orbMark: { width: 96, height: 96, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  orbCore: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    backgroundColor: colors.brandTertiary,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 24,
    elevation: 12,
  },
  title: { fontFamily: fonts.displayBold, fontSize: 44, letterSpacing: 6, color: colors.onSurface },
  subtitle: { fontFamily: fonts.monoBold, fontSize: 15, letterSpacing: 8, color: colors.brand },
  tagline: { fontFamily: fonts.mono, fontSize: 13, color: colors.onSurfaceTertiary, marginTop: spacing.md, textAlign: "center" },
  footer: { gap: spacing.md },
  googleBtn: {
    height: 56,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandPrimary,
  },
  googleText: { fontFamily: fonts.monoBold, fontSize: 15, letterSpacing: 2, color: colors.onBrandPrimary },
  legal: { fontFamily: fonts.mono, fontSize: 11, color: colors.muted, textAlign: "center" },
}));
