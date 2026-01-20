import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';

interface AudioFile {
  uri: string;
  mimeType: string;
  filename: string;
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    // Request permissions on mount
    const requestPermissions = async () => {
      try {
        const { granted } = await Audio.requestPermissionsAsync();
        if (isMountedRef.current) {
          setHasPermission(granted);
        }
      } catch (err) {
        console.error('Failed to request audio permissions:', err);
        if (isMountedRef.current) {
          setHasPermission(false);
        }
      }
    };

    requestPermissions();

    return () => {
      isMountedRef.current = false;
      // Cleanup recording on unmount
      if (recordingRef.current) {
        recordingRef.current
          .stopAndUnloadAsync()
          .then(() => {
            Audio.setAudioModeAsync({
              allowsRecordingIOS: false,
              playsInSilentModeIOS: true,
            });
          })
          .catch((err) => {
            console.error('Failed to cleanup recording:', err);
          });
      }
    };
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    if (!isMountedRef.current) return;

    try {
      // Check permissions
      if (hasPermission === false) {
        throw new Error('Microphone permission denied');
      }

      if (hasPermission === null) {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) {
          throw new Error('Microphone permission denied');
        }
        if (isMountedRef.current) {
          setHasPermission(true);
        }
      }

      // Stop existing recording if any
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        recordingRef.current = null;
      }

      // Set audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Create new recording
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      if (!isMountedRef.current) {
        await recording.stopAndUnloadAsync();
        return;
      }

      recordingRef.current = recording;
      setIsRecording(true);
    } catch (err) {
      recordingRef.current = null;
      if (isMountedRef.current) {
        setIsRecording(false);
      }
      const message = err instanceof Error ? err.message : 'Failed to start recording';
      throw new Error(`Recording start failed: ${message}`);
    }
  }, [hasPermission]);

  const stopRecording = useCallback(async (): Promise<AudioFile> => {
    if (!recordingRef.current) {
      throw new Error('No active recording to stop');
    }

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();

      if (!uri) {
        throw new Error('No recording URI available');
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      recordingRef.current = null;
      if (isMountedRef.current) {
        setIsRecording(false);
      }

      return {
        uri,
        mimeType: 'audio/m4a',
        filename: 'recording.m4a',
      };
    } catch (err) {
      recordingRef.current = null;
      if (isMountedRef.current) {
        setIsRecording(false);
      }
      const message = err instanceof Error ? err.message : 'Failed to stop recording';
      throw new Error(`Recording stop failed: ${message}`);
    }
  }, []);

  return {
    isRecording,
    hasPermission,
    startRecording,
    stopRecording,
  };
}
