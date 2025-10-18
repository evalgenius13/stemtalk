import { NextResponse } from "next/server";
import { parseBuffer } from "music-metadata";
import { decode } from "wav-decoder";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function analyzeAudio(samples, sampleRate) {
  const n = samples.length;
  const rms = Math.sqrt(samples.reduce((a, v) => a + v * v, 0) / n);
  const peak = Math.max(...samples.map((v) => Math.abs(v)));
  const dr = 20 * Math.log10(peak / rms);
  const lufs = -0.691 + 10 * Math.log10(rms ** 2);
  const mean = samples.reduce((a, v) => a + v, 0) / n;
  const stereoWidth = Math.abs(mean) < 0.01 ? 0.7 : 0.9;

  return {
    rms: rms.toFixed(3),
    peak: peak.toFixed(3),
    dynamicRange: dr.toFixed(2),
    lufs: lufs.toFixed(2),
    stereoWidth,
  };
}

export async function POST(req) {
  try {
    const data = await req.formData();
    const file = data.get("file");
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const meta = await parseBuffer(buffer, file.type);
    const wav = await decode(buffer);
    const channelData = wav.channelData[0];
    const sampleRate = wav.sampleRate;

    const analysis = analyzeAudio(channelData, sampleRate);

    const prompt = `
You are an experienced mix engineer.
Given these metrics, provide 3 short insights about mix quality (hip hop, trap, R&B):

LUFS: ${analysis.lufs}
RMS: ${analysis.rms}
Peak: ${analysis.peak}
Dynamic Range: ${analysis.dynamicRange}
Stereo Width: ${analysis.stereoWidth}

Respond as JSON:
{
  "mixSummary": "...",
  "recommendations": ["...", "...", "..."]
}`;

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    });

    const responseText = ai.choices[0].message.content;
    let feedback;
    try {
      feedback = JSON.parse(responseText);
    } catch {
      feedback = { mixSummary: responseText, recommendations: [] };
    }

    return NextResponse.json({ analysis, feedback });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export const config = {
  api: { bodyParser: false },
};
