import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { fonts, makeStyles, radius, useTheme } from "@/src/theme";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";

const CONFIG: Record<OrbState, { duration: number; label: string }> = {
  idle: { duration: 2400, label: "TAP TO SPEAK" },
  listening: { duration: 850, label: "LISTENING" },
  thinking: { duration: 1100, label: "THINKING" },
  speaking: { duration: 650, label: "SPEAKING" },
  error: { duration: 2400, label: "OFFLINE" },
};

function MicGlyph({ color }: { color: string }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 20, height: 34, borderRadius: 10, backgroundColor: color }} />
      <View style={{ width: 30, height: 14, borderBottomWidth: 3, borderColor: color, borderBottomLeftRadius: 15, borderBottomRightRadius: 15, marginTop: -6 }} />
      <View style={{ width: 3, height: 8, backgroundColor: color }} />
      <View style={{ width: 20, height: 3, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

export function VoiceOrb({
  state,
  onPress,
  disabled,
}: {
  state: OrbState;
  onPress: () => void;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const progress = useSharedValue(0);
  const spin = useSharedValue(0);

  const accent = state === "error" ? colors.error : colors.brand;
  const cfg = CONFIG[state];

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    progress.value = withRepeat(withTiming(1, { duration: cfg.duration, easing: Easing.out(Easing.ease) }), -1, false);
  }, [state, cfg.duration, progress]);

  useEffect(() => {
    cancelAnimation(spin);
    if (state === "thinking") {
      spin.value = 0;
      spin.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1, false);
    }
  }, [state, spin]);

  const ring1 = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 0.45 }],
    opacity: 0.5 * (1 - progress.value),
  }));
  const ring2 = useAnimatedStyle(() => {
    const p = (progress.value + 0.5) % 1;
    return { transform: [{ scale: 1 + p * 0.45 }], opacity: 0.35 * (1 - p) };
  });
  const core = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + Math.sin(progress.value * Math.PI) * (state === "idle" ? 0.02 : 0.06) }],
  }));
  const arc = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));

  return (
    <View style={styles.wrap} testID="voice-orb-wrap">
      <Animated.View style={[styles.ring, { borderColor: accent }, ring1]} pointerEvents="none" />
      <Animated.View style={[styles.ring, { borderColor: accent }, ring2]} pointerEvents="none" />
      {state === "thinking" && (
        <Animated.View style={[styles.arc, { borderTopColor: accent }, arc]} pointerEvents="none" />
      )}
      <Pressable onPress={onPress} disabled={disabled} testID="voice-orb-button">
        <Animated.View style={[styles.coreShadow, { shadowColor: accent }, core]}>
          <LinearGradient
            colors={[colors.brandTertiary, colors.surfaceSecondary]}
            style={[styles.core, { borderColor: accent }]}
          >
            {state === "idle" || state === "listening" || state === "error" ? (
              <MicGlyph color={accent} />
            ) : (
              <Text style={[styles.coreLabel, { color: accent }]}>{state === "thinking" ? "· · ·" : "))) "}</Text>
            )}
          </LinearGradient>
        </Animated.View>
      </Pressable>
      <Text style={[styles.stateLabel, { color: accent }]} testID="voice-orb-label">
        {cfg.label}
      </Text>
    </View>
  );
}

const CORE = 156;
const RING = 220;
const useStyles = makeStyles((colors) => ({
  wrap: { width: RING, height: RING + 34, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    top: 0,
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 1.5,
  },
  arc: {
    position: "absolute",
    top: (RING - (CORE + 24)) / 2,
    width: CORE + 24,
    height: CORE + 24,
    borderRadius: (CORE + 24) / 2,
    borderWidth: 2,
    borderColor: "transparent",
  },
  coreShadow: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 28,
    elevation: 16,
    borderRadius: CORE / 2,
  },
  core: {
    width: CORE,
    height: CORE,
    borderRadius: CORE / 2,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  coreLabel: { fontFamily: fonts.monoBold, fontSize: 30, letterSpacing: 2 },
  stateLabel: {
    position: "absolute",
    bottom: 0,
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    letterSpacing: 3,
  },
}));

export { radius };
