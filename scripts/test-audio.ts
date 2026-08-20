import fs from "fs";
import { parseAudioVoiceNote } from "../src/ai/parsers/audio.parser.js";

async function test() {
  const audioBuffer = fs.readFileSync("/Users/heizaaa/Desktop/cdev/wa-agent/WhatsApp Audio 2026-08-20 at 07.10.02.opus");
  console.log("Audio buffer size:", audioBuffer.length);

  const result = await parseAudioVoiceNote(audioBuffer, "audio/ogg");
  console.log("Audio parse result:", JSON.stringify(result, null, 2));
}

test().catch(console.error);
