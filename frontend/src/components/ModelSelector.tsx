import * as Haptics from "expo-haptics";
import { Platform, Pressable, ScrollView, Text } from "react-native";

import { fonts, makeStyles, radius, spacing } from "@/src/theme";

export type ModelKey = "grok" | "chatgpt" | "gemini" | "claude" | "auto";

const MODELS: { key: ModelKey; label: string }[] = [
  { key: "grok", label: "GROK" },
  { key: "chatgpt", label: "CHATGPT" },
  { key: "gemini", label: "GEMINI" },
  { key: "claude", label: "CLAUDE" },
  { key: "auto", label: "AUTO" },
];

export function ModelSelector({
  value,
  onChange,
}: {
  value: ModelKey;
  onChange: (m: ModelKey) => void;
}) {
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      testID="model-selector"
    >
      {MODELS.map((m) => {
        const active = m.key === value;
        return (
          <Pressable
            key={m.key}
            testID={`model-${m.key}`}
            style={[styles.pill, active ? styles.pillActive : styles.pillIdle]}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
              onChange(m.key);
            }}
          >
            <Text style={[styles.label, active ? styles.labelActive : styles.labelIdle]}>{m.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { gap: spacing.sm, paddingRight: spacing.lg },
  pill: {
    flexShrink: 0,
    minWidth: 74,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  pillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pillIdle: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
  label: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 1 },
  labelActive: { color: colors.onBrandPrimary },
  labelIdle: { color: colors.onSurfaceTertiary },
}));
