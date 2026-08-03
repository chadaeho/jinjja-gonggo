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
  res.status(out.ok ? 200 : 500).json(out);
}
