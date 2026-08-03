/** 상태 점검 — 배포 후 키·데이터·모델 정상 여부 확인용 */
import fs from "node:fs"; import path from "node:path";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const out = { ok: true, time: new Date().toISOString() };
  try {
    const D = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "announcements.json"), "utf-8"));
    out.dataset = { count: D.count, syncedAt: D.syncedAt };
  } catch (e) { out.ok = false; out.dataset = { error: String(e.message) }; }

  const key = process.env.GEMINI_API_KEY;
  out.gemini = { keyPresent: !!key };
  if (key) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(key));
      const j = await r.json();
      out.gemini.status = r.status;
      out.gemini.availableFlash = (j.models || [])
        .map((m) => m.name.replace("models/", ""))
        .filter((n) => /flash/i.test(n) && !/embedding|tts|image|audio|live/i.test(n))
        .slice(0, 12);
    } catch (e) { out.gemini.error = String(e.message).slice(0, 120); }
  }
  // ?probe=1 : 모델별로 실제 생성 호출을 1회씩 시도하여 사유 확인
  const u = new URL(req.url || "/", "http://x");
  if (key && u.searchParams.get("probe")) {
    const list = (process.env.GEMINI_MODELS ||
      "gemini-2.0-flash,gemini-2.5-flash,gemini-flash-latest,gemini-2.0-flash-lite,gemini-3-flash-preview")
      .split(",").map((x) => x.trim());
    out.probe = [];
    for (const m of list) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ok" }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 16 } }) }
        );
        const b = await r.json();
        out.probe.push({
          model: m, status: r.status,
          error: b?.error?.message ? String(b.error.message).slice(0, 240) : undefined,
          text: b?.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 30),
        });
      } catch (e) { out.probe.push({ model: m, error: String(e.message).slice(0, 160) }); }
    }
  }

  res.status(out.ok ? 200 : 500).json(out);
}
