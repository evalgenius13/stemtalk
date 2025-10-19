import { NextResponse } from "next/server";
import { parseBuffer } from "music-metadata";
import { decode } from "wav-decoder";
import OpenAI from "openai";

// Force Node runtime so Buffer and native modules work correctly in Next
export const runtime = "nodejs";
// Force dynamic rendering to support uploads
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function analyzeAudio(samples, sampleRate) {
  const n = samples.length;
  if (n === 0) {
    return {
      rms: "0.000",
      peak: "0.000",
      dynamicRange: "0.00",
      lufs: "0.00",
      stereoWidth: 0,
    };
  }

  const rms = Math.sqrt(samples.reduce((a, v) => a + v * v, 0) / n);
  const peak = Math.max(...samples.map((v) => Math.abs(v)));
  const dr = peak > 0 && rms > 0 ? 20 * Math.log10(peak / rms) : 0;
  const lufs = -0.691 + 10 * Math.log10(Math.max(rms ** 2, 1e-12));
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
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Convert uploaded file to ArrayBuffer and Node Buffer where needed
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse metadata using Buffer (music-metadata accepts Buffer)
    let metadata = {};
    try {
      // second argument can be the mime type
      metadata = (await parseBuffer(buffer, { mimeType: file.type })).format || {};
    } catch (err) {
      // non-fatal: we can continue without metadata
      console.warn("music-metadata parse failed:", err?.message || err);
      metadata = {};
    }

    // Decode audio with wav-decoder (expects ArrayBuffer)
    // Note: wav-decoder handles PCM WAV. If an mp3/other format is uploaded decode may fail.
    let wav;
    try {
      wav = await decode(arrayBuffer);
    } catch (err) {
      // If decode fails, return friendly error
      console.error("wav-decoder failed:", err?.message || err);
      return NextResponse.json(
        { error: "Failed to decode audio. Please upload a WAV or supported PCM file." },
        { status: 415 }
      );
    }

    // channelData is an array per channel; pick first channel or average channels
    const channels = wav.channelData || [];
    if (!channels.length || !channels[0] || channels[0].length === 0) {
      return NextResponse.json({ error: "No audio samples found" }, { status: 422 });
    }

    let samples = channels[0];
    if (channels.length > 1) {
      // simple downmix to mono by averaging channels sample-wise (if lengths match)
      try {
        const len = Math.min(...channels.map((c) => c.length));
        const mono = new Float32Array(len);
        for (let i = 0; i < len; i++) {
          let sum = 0;
          for (let ch = 0; ch < channels.length; ch++) sum += channels[ch][i];
          mono[i] = sum / channels.length;
        }
        samples = mono;
      } catch {
        // fallback to first channel
        samples = channels[0];
      }
    }

    const sampleRate = wav.sampleRate || metadata.sampleRate || 44100;
    const analysis = analyzeAudio(Array.from(samples), sampleRate);

    // Build prompt for OpenAI to return JSON feedback
    const prompt = `
You are an experienced mix engineer.
Given these metrics, provide 3 concise insights about mix quality for hip hop, trap, or R&B:

LUFS: ${analysis.lufs}
RMS: ${analysis.rms}
Peak: ${analysis.peak}
Dynamic Range: ${analysis.dynamicRange}
Stereo Width: ${analysis.stereoWidth}

Respond in JSON exactly as a single JSON object, without additional explanation:
{
  "mixSummary": "...",
  "recommendations": ["...", "...", "..."]
}
`;

    // Call OpenAI (using chat completions)
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    });

    const text = ai?.choices?.[0]?.message?.content || "";
    let feedback;
    try {
      feedback = JSON.parse(text);
    } catch {
      // If model doesn't produce strictly valid JSON, wrap it
      feedback = { mixSummary: text.trim(), recommendations: [] };
    }

    return NextResponse.json({ analysis, feedback, metadata });
  } catch (err) {
    console.error("Unhandled error in analyze route:", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
