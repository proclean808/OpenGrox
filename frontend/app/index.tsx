import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useCallback, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type CommandResult } from "@/src/api";
import { playUrl, stopPlayback } from "@/src/audio";
import { ModelSelector, type ModelKey } from "@/src/components/ModelSelector";
import { StatusBadge } from "@/src/components/StatusBadge";
import { VoiceOrb, type OrbState } from "@/src/components/VoiceOrb";
import { storage } from "@/src/utils/storage";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1649962843028-54905316eb21?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzd8MHwxfHNlYXJjaHwyfHxzY2klMjBmaSUyMGRhcmslMjB0ZXh0dXJlJTIwYmFja2dyb3VuZHxlbnwwfHx8fDE3OTA1MDg5NzR8MA&ixlib=rb-4.1.0&q=85";

export default function Cockpit() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [model, setModel] = useState<ModelKey>("auto");
  const [orb, setOrb] = useState<OrbState>("idle");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("Awaiting command...");
  const [transcript, setTranscript] = useState<string>("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [typed, setTyped] = useState("");
  const [permHint, setPermHint] = useState<string | null>(null);

  const [connId, setConnId] = useState<string | null>(null);
  const [connLabel, setConnLabel] = useState<string>("");
  const [connOnline, setConnOnline] = useState<boolean | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingRef = useRef(false);

  const refreshConnection = useCallback(async () => {
    const id = await storage.getItem<string | null>("connectionId", null);
    setConnId(id);
    if (!id) {
      setConnOnline(null);
      setConnLabel("");
      return;
    }
    const st = await api.connectionStatus(id);
    setConnOnline(st.status === "connected");
    setConnLabel(st.label || "My Phone");
    if (st.status !== "connected") setOrb((o) => (o === "idle" ? "error" : o));
    else setOrb((o) => (o === "error" ? "idle" : o));
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const m = await storage.getItem<ModelKey>("model", "auto");
        if (m) setModel(m);
        await refreshConnection();
      })();
    }, [refreshConnection]),
  );

  const pickModel = (m: ModelKey) => {
    setModel(m);
    storage.setItem("model", m);
  };

  async function runCommand(text: string) {
    if (!text.trim()) return;
    setTranscript(text);
    setResult(null);
    setBusy(true);
    setOrb("thinking");
    setAction("Executing on your phone...");
    try {
      const res = await api.command(text, model, connId);
      setResult(res);
      setAction(res.spoken);
      if (Platform.OS !== "web") {
        if (res.status === "VERIFIED") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        else if (res.status === "FAILED") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
      const url = api.ttsUrl(res.tts_url);
      if (url) {
        setOrb("speaking");
        await playUrl(url, () => setOrb("idle"));
      } else {
        setOrb("idle");
      }
    } catch {
      setAction("I couldn't complete that. Try again.");
      setOrb("idle");
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    setPermHint(null);
    try {
      let perm = await AudioModule.getRecordingPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setPermHint(
          perm.canAskAgain
            ? "Microphone access is needed to talk to your droid."
            : "Microphone is blocked. Enable it in Settings to use voice.",
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setResult(null);
      setTranscript("");
      setAction("Listening...");
      setOrb("listening");
    } catch {
      setPermHint("Voice capture isn't available here. Type your command below.");
      setOrb("idle");
    }
  }

  async function stopRecordingAndSend() {
    recordingRef.current = false;
    setOrb("thinking");
    setAction("Transcribing...");
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("no audio");
      const { text } = await api.transcribe(uri);
      if (!text.trim()) {
        setAction("I didn't catch that. Try again.");
        setOrb("idle");
        setBusy(false);
        return;
      }
      await runCommand(text);
    } catch {
      setAction("Couldn't transcribe audio. Type your command below.");
      setOrb("idle");
      setBusy(false);
    }
  }

  function onOrbPress() {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (recordingRef.current) return stopRecordingAndSend();
    if (busy) return;
    return startRecording();
  }

  async function onStop() {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    stopPlayback();
    setAction("Stopping...");
    await api.stop(connId);
    recordingRef.current = false;
    setBusy(false);
    setOrb("idle");
  }

  function sendTyped() {
    const t = typed.trim();
    if (!t || busy) return;
    setTyped("");
    runCommand(t);
  }

  const pillColor = connOnline === null ? colors.muted : connOnline ? colors.success : colors.error;
  const pillText = connId ? (connOnline ? `${connLabel} ONLINE` : `${connLabel} OFFLINE`) : "NO PHONE LINKED";

  return (
    <View style={styles.root}>
      <Image source={{ uri: HERO }} style={styles.hero} contentFit="cover" transition={300} />
      <LinearGradient
        colors={["rgba(9,11,13,0.55)", "rgba(9,11,13,0.85)", colors.surface]}
        style={styles.scrim}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable style={styles.statusPill} onPress={() => router.push("/connect")} testID="status-pill">
              <View style={[styles.statusDot, { backgroundColor: pillColor }]} />
              <Text style={[styles.statusText, { color: pillColor }]}>{pillText}</Text>
            </Pressable>
            <Text style={styles.wordmark}>OPENGROX</Text>
          </View>

          <ModelSelector value={model} onChange={pickModel} />

          {/* Orb stage */}
          <View style={styles.stage}>
            <VoiceOrb state={orb} onPress={onOrbPress} disabled={false} />
          </View>

          {/* Current action */}
          <View style={styles.actionRow}>
            <Text style={styles.actionPrompt}>{">"}</Text>
            <Text style={styles.actionText} testID="current-action">
              {action}
            </Text>
          </View>

          {permHint && (
            <Pressable
              testID="perm-hint"
              onPress={() => Linking.openSettings()}
              style={styles.permHint}
            >
              <Text style={styles.permHintText}>{permHint} Tap to open Settings.</Text>
            </Pressable>
          )}

          {/* Result card */}
          {result && (
            <View style={styles.card} testID="result-card">
              <StatusBadge status={result.status} />
              {transcript ? (
                <Text style={styles.cardTranscript} testID="result-transcript">
                  YOU: {transcript}
                </Text>
              ) : null}
              <Text style={styles.cardSpoken} testID="result-spoken">
                {result.spoken}
              </Text>
              {typeof result.details?.battery_level === "number" && (
                <Text style={styles.cardMeta}>
                  BATTERY {String(result.details.battery_level)}%
                  {result.details.charging ? " · CHARGING" : ""}
                </Text>
              )}
              {Array.isArray(result.details?.citations) && result.details.citations.length > 0 && (
                <View style={styles.citations}>
                  <Text style={styles.cardMeta}>SOURCES</Text>
                  {result.details.citations.slice(0, 3).map((u: string, i: number) => (
                    <Text
                      key={i}
                      style={styles.citationLink}
                      numberOfLines={1}
                      onPress={() => Linking.openURL(u)}
                      testID={`citation-${i}`}
                    >
                      {i + 1}. {u}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* STOP */}
          {busy && (
            <Pressable style={styles.stopBtn} onPress={onStop} testID="stop-button">
              <View style={styles.stopSquare} />
              <Text style={styles.stopText}>STOP</Text>
            </Pressable>
          )}

          {/* Typed command fallback */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="or type a command..."
              placeholderTextColor={colors.muted}
              value={typed}
              onChangeText={setTyped}
              onSubmitEditing={sendTyped}
              returnKeyType="send"
              editable={!busy}
              testID="command-input"
            />
            <Pressable style={styles.sendBtn} onPress={sendTyped} disabled={busy} testID="send-button">
              <Text style={styles.sendText}>SEND</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  hero: { position: "absolute", top: 0, left: 0, right: 0, height: 420, opacity: 0.5 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, height: 480 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg, minHeight: "100%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 1 },
  wordmark: { fontFamily: fonts.displayBold, fontSize: 18, letterSpacing: 3, color: colors.onSurface },
  stage: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.md },
  actionRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  actionPrompt: { fontFamily: fonts.monoBold, fontSize: 14, color: colors.brand, marginTop: 1 },
  actionText: { flex: 1, fontFamily: fonts.mono, fontSize: 14, color: colors.onSurfaceSecondary, lineHeight: 20 },
  permHint: {
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
  },
  permHintText: { fontFamily: fonts.mono, fontSize: 12, color: colors.warning },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
  },
  cardTranscript: { fontFamily: fonts.mono, fontSize: 12, color: colors.muted, letterSpacing: 0.5 },
  cardSpoken: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, lineHeight: 26 },
  cardMeta: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.brand, letterSpacing: 1 },
  citations: { gap: spacing.xs },
  citationLink: { fontFamily: fonts.mono, fontSize: 11, color: colors.info },
  stopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.error,
  },
  stopSquare: { width: 14, height: 14, backgroundColor: colors.onError, borderRadius: 2 },
  stopText: { fontFamily: fonts.monoBold, fontSize: 15, letterSpacing: 3, color: colors.onError },
  inputRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: "auto" },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.onSurface,
    fontFamily: fonts.mono,
    fontSize: 14,
    backgroundColor: colors.surfaceSecondary,
  },
  sendBtn: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandPrimary,
  },
  sendText: { fontFamily: fonts.monoBold, fontSize: 13, letterSpacing: 1, color: colors.onBrandPrimary },
}));
