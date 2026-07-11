interface ElevenLabsAddVoiceResponse {
  voice_id?: string;
}

export async function cloneVoiceWithElevenLabs(
  apiKey: string,
  name: string,
  audio: Blob,
): Promise<string> {
  const form = new FormData();
  form.append("name", name);
  form.append("files", audio, "voice-sample.webm");
  form.append("description", "PhaseShift in-app voice clone");

  const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`ElevenLabs voice clone failed (${response.status}): ${detail.slice(0, 400)}`);
  }

  const body = (await response.json()) as ElevenLabsAddVoiceResponse;
  if (!body.voice_id) {
    throw new Error("ElevenLabs voice clone returned no voice_id");
  }
  return body.voice_id;
}
