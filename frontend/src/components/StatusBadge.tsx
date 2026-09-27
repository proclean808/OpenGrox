import { Text, View } from "react-native";

import { fonts, makeStyles, radius, useTheme } from "@/src/theme";
import type { CommandStatus } from "@/src/api";

export function StatusBadge({ status }: { status: CommandStatus }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const map: Record<CommandStatus, { bg: string; fg: string }> = {
    VERIFIED: { bg: colors.success, fg: colors.onSuccess },
    FAILED: { bg: colors.error, fg: colors.onError },
    UNKNOWN: { bg: colors.warning, fg: colors.onWarning },
    STOPPED: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary },
  };
  const c = map[status];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]} testID={`status-badge-${status}`}>
      <View style={[styles.dot, { backgroundColor: c.fg }]} />
      <Text style={[styles.text, { color: c.fg }]}>{status}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontFamily: fonts.monoBold, fontSize: 13, letterSpacing: 2 },
}));
