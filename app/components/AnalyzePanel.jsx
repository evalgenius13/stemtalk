"use client";
import { useState } from "react";

export default function AnalyzePanel() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/analyze", { method: "POST", body: formData });
    const data = await res.json();
    setResult(data);
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
      <h2>Stem or Mix Analyzer</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setFile(e.target.files[0])}
        />
        <button type="submit" disabled={!file || loading}>
          {loading ? "Analyzing..." : "Upload & Analyze"}
        </button>
      </form>

      {result && (
        <div style={{ marginTop: 20, textAlign: "left" }}>
          <h3>Analysis</h3>
          <pre>{JSON.stringify(result.analysis, null, 2)}</pre>
          <h3>Feedback</h3>
          <p>{result.feedback?.mixSummary}</p>
          <ul>
            {result.feedback?.recommendations?.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
