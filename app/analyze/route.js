import { NextResponse } from "next/server";
import { parseBuffer } from "music-metadata";
import { decode } from "wav-decoder";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- basic DSP metrics ---
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

// --- main handler ---
export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const metadata = await parseBuffer(buffer, file.type);
    const wav = await decode(buffer);
    const samples = wav.channelData[0];
    const sampleRate = wav.sampleRate;
    const analysis = analyzeAudio(samples, sampleRate);

    const prompt = `
You are an experienced mix engineer.
Given these metrics, provide 3 concise insights about mix quality for hip hop, trap, or R&B:

LUFS: ${analysis.lufs}
RMS: ${analysis.rms}
Peak: ${analysis.peak}
Dynamic Range: ${analysis.dynamicRange}
Stereo Width: ${analysis.stereoWidth}

Respond in JSON:
{
  "mixSummary": "...",
  "recommendations": ["...", "...", "..."]
}`;

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    });

    const text = ai.choices[0].message.content;
    let feedback;
    try {
      feedback = JSON.parse(text);
    } catch {
      feedback = { mixSummary: text, recommendations: [] };
    }

    return NextResponse.json({ analysis, feedback });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
