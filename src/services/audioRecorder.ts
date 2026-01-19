import { Audio } from 'expo-av';

let recording: Audio.Recording | null = null;

export async function startRecording(): Promise<void> {
  try {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      throw new Error('Microphone permission denied');
    }

    if (recording) {
      await stopRecording();
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording: newRecording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );

    recording = newRecording;
  } catch (err) {
    recording = null;
    const message = err instanceof Error ? err.message : 'Failed to start recording';
    throw new Error(`Recording start failed: ${message}`);
  }
}

export async function stopRecording(): Promise<{
  uri: string;
  mimeType: string;
  filename: string;
}> {
  if (!recording) {
    throw new Error('No active recording to stop');
  }

  try {
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();

    if (!uri) {
      throw new Error('No recording URI available');
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });

    recording = null;

    return {
      uri,
      mimeType: 'audio/m4a',
      filename: 'recording.m4a',
    };
  } catch (err) {
    recording = null;
    const message = err instanceof Error ? err.message : 'Failed to stop recording';
    throw new Error(`Recording stop failed: ${message}`);
  }
}
