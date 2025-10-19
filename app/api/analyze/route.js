import { NextResponse } from "next/server";

// Run under Node runtime so Buffer and Node APIs are available at runtime
export const runtime = "nodejs";
// Keep dynamic to allow request-time behavior for uploads
export const dynamic = "force-dynamic";

/**
 * Important change:
 * - All heavy or native/third-party modules (music-metadata, wav-decoder, openai)
 *   are dynamically imported inside the request handler to avoid build-time
 *   evaluation/bundling errors. This prevents Next's build from trying to
 *   statically analyze or bundle modules that may fail during build.
 */
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

    // Read file data
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Dynamically import modules at request time to avoid build-time bundling errors
    const mm = await import("music-metadata").catch((e) => {
      console.warn("failed to import music-metadata:", e?.message || e);
      return null;
    });
    const wavDecoder = await import("wav-decoder").catch((e) => {
      console.warn("failed to import wav-decoder:", e?.message || e);
      return null;
    });
    const OpenAI = (await import("openai")).default?.catch?.(() => null) ?? (await import("openai")).default;

    // Parse metadata (non-fatal)
    let metadata = {};
    if (mm && mm.parseBuffer) {
      try {
        const parsed = await mm.parseBuffer(buffer, { mimeType: file.type });
        metadata = parsed?.format || {};
      } catch (err) {
        console.warn("music-metadata parse failed:", err?.message || err);
      }
    }

    // Decode audio (wav-decoder expects ArrayBuffer and supports PCM WAV)
    if (!wavDecoder || !wavDecoder.decode) {
      return NextResponse.json(
        { error: "Audio decoder not available on the server. Ensure wav-decoder is installed." },
        { status: 500 }
      );
    }

    let wav;
    try {
      wav = await wavDecoder.decode(arrayBuffer);
    } catch (err) {
      console.error("wav-decoder failed:", err?.message || err);
      return NextResponse.json(
        { error: "Failed to decode audio. Please upload a WAV (PCM) file or use a server decoder (ffmpeg) for other formats." },
        { status: 415 }
      );
    }

    const channels = wav.channelData || [];
    if (!channels.length || !channels[0] || channels[0].length === 0) {
      return NextResponse.json({ error: "No audio samples found" }, { status: 422 });
    }

    // If multi-channel, downmix to mono
    let samples = channels[0];
    if (channels.length > 1) {
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
        samples = channels[0];
      }
    }

    const sampleRate = wav.sampleRate || metadata.sampleRate || 44100;
    const analysis = analyzeAudio(Array.from(samples), sampleRate);

    // Build prompt
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

    // Create OpenAI client and call model (dynamically imported)
    if (!OpenAI) {
      // If the OpenAI client couldn't be imported for some reason, return an error
      console.warn("openai client not available");
      return NextResponse.json({ analysis, feedback: { mixSummary: "OpenAI client not available", recommendations: [] }, metadata }, { status: 200 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Some versions of the OpenAI JS client expose different methods.
    // Try chat.completions.create, otherwise fallback to the older/newer shapes.
    let aiText = "";
    try {
      if (openai.chat?.completions?.create) {
        const ai = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.5,
        });
        aiText = ai?.choices?.[0]?.message?.content ?? "";
      } else if (openai.chat?.create) {
        const ai = await openai.chat.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
        });
        aiText = ai?.choices?.[0]?.message?.content ?? "";
      } else if (openai.completions?.create) {
        const ai = await openai.completions.create({
          model: "gpt-4o-mini",
          prompt,
          max_tokens: 500,
        });
        aiText = ai?.choices?.[0]?.text ?? "";
      } else {
        aiText = "OpenAI client API surface unexpected; no completion was called.";
      }
    } catch (err) {
      console.error("OpenAI call failed:", err?.message || err);
      aiText = err?.message || "";
    }

    let feedback;
    try {
      feedback = JSON.parse(aiText);
    } catch {
      feedback = { mixSummary: aiText.trim(), recommendations: [] };
    }

    return NextResponse.json({ analysis, feedback, metadata });
  } catch (err) {
    console.error("Unhandled error in analyze route:", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
