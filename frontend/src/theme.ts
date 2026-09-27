// Design tokens for OpenGrox Command Droid — "Dark-First Utility" cockpit.
// Single dark scheme (filled from /app/design_guidelines.json). Components read
// colors via makeStyles()/useTheme(); fonts/spacing/radius are exported below.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#090B0D",
  onSurface: "#E5E7EB",
  surfaceSecondary: "#111519",
  onSurfaceSecondary: "#D1D5DB",
  surfaceTertiary: "#1A2026",
  onSurfaceTertiary: "#9CA3AF",
  surfaceInverse: "#F3F4F6",
  onSurfaceInverse: "#090B0D",
  muted: "#6B7280",

  brand: "#00FF66",
  onBrand: "#001A0A",
  brandPrimary: "#00FF66",
  onBrandPrimary: "#001A0A",
  brandSecondary: "#00CC52",
  onBrandSecondary: "#001A0A",
  brandTertiary: "#1A3324",
  onBrandTertiary: "#00FF66",

  success: "#00FF66",
  onSuccess: "#001A0A",
  warning: "#FFB800",
  onWarning: "#1A1300",
  error: "#FF3333",
  onError: "#1A0000",
  info: "#4ADE80",
  onInfo: "#001A0A",

  border: "#212930",
  borderStrong: "#33414C",
  divider: "#1A2026",
};

export type ThemeColors = typeof dark;

// Use the dark palette everywhere (app is dark-only).
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light: dark };
export const defaultScheme = "light" satisfies ColorScheme;

export const fonts = {
  display: "Rajdhani",
  displaySemiBold: "Rajdhani-SemiBold",
  displayBold: "Rajdhani-Bold",
  mono: "JetBrainsMono",
  monoMedium: "JetBrainsMono-Medium",
  monoBold: "JetBrainsMono-Bold",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 2, md: 4, lg: 8, pill: 999 };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}
setColorScheme?.(defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
