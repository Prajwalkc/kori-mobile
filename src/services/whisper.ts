import * as FileSystem from 'expo-file-system/legacy';

const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

interface TranscribeArgs {
  uri: string;
  filename: string;
  mimeType: string;
}

interface TranscriptionResponse {
  text: string;
}

export async function transcribeAudioFile(args: TranscribeArgs): Promise<string> {
  const { uri, filename, mimeType } = args;

  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error(
      'Missing OpenAI API key. Add EXPO_PUBLIC_OPENAI_API_KEY to your .env file.'
    );
  }

  try {
    const response = await FileSystem.uploadAsync(OPENAI_API_URL, uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: mimeType,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      parameters: {
        model: 'whisper-1',
      },
    });

    if (response.status !== 200) {
      throw new Error(`OpenAI API error (${response.status}): ${response.body}`);
    }

    const data: TranscriptionResponse = JSON.parse(response.body);
    
    if (!data.text) {
      throw new Error('No transcript returned from API');
    }

    return data.text;
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Failed to transcribe audio');
  }
}
