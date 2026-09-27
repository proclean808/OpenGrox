// Voice playback helper (expo-audio). One module-level player, per the integration
// playbook, so narration never stacks across screens.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

let player: AudioPlayer | null = null;

function getPlayer(): AudioPlayer {
  if (!player) player = createAudioPlayer();
  return player;
}

export async function playUrl(url: string, onDone?: () => void): Promise<void> {
  try {
    // Route audio to the speaker (not the earpiece) and allow silent-mode playback.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const p = getPlayer();
    p.replace({ uri: url });
    if (onDone) {
      const sub = p.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) {
          sub.remove();
          onDone();
        }
      });
    }
    p.seekTo(0);
    p.play();
  } catch {
    onDone?.();
  }
}

export function stopPlayback(): void {
  try {
    player?.pause();
  } catch {
    /* noop */
  }
}
