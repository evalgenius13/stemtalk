"use client";
import { useState } from "react";

export default function AnalyzePanel() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!file) {
      setError("Please select an audio file.");
      return;
    }
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err?.error || "Upload failed");
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err.message || "Analysis failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
      <h2>Stem or Mix Analyzer</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="file"
          accept="audio/*, .wav, .mp3, .m4a, .flac"
          onChange={(e) => setFile(e.target.files[0] || null)}
        />
        <button type="submit" disabled={!file || loading} style={{ marginLeft: 8 }}>
          {loading ? "Analyzing..." : "Upload & Analyze"}
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 20, textAlign: "left" }}>
          <h3>Analysis</h3>
          <pre>{JSON.stringify(result.analysis, null, 2)}</pre>

          <h3>Feedback</h3>
          <p>{result.feedback?.mixSummary || "No summary returned."}</p>

          <ul>
            {result.feedback?.recommendations?.length ? (
              result.feedback.recommendations.map((r, i) => <li key={i}>{r}</li>)
            ) : (
              <li>No recommendations returned.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
