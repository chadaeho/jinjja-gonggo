import fs from "node:fs";
import path from "node:path";
import { maskPII, ruleSignals, matchProgram, judge, guidance, heuristicExtract, liveTopUp } from "./_lib.js";

/* ---------------- 공고 DB (콜드스타트 시 1회 로드) ---------------- */
let DB = null;
function db() {
  if (DB) return DB;
  const p = path.join(process.cwd(), "data", "announcements.json");
  DB = JSON.parse(fs.readFileSync(p, "utf-8"));
  return DB;
}

/* ---------------- Gemini ---------------- */
const MODELS = (process.env.GEMINI_MODELS ||
  "gemini-3-flash-preview,gemini-flash-latest,gemini-3.5-flash,gemini-3.1-flash-lite,gemini-flash-lite-latest")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
let OK_MODEL = null;

const EXTRACT_PROMPT = `당신은 한국 소상공인이 받은 문자메시지에서 사실 정보를 추출하는 분석기다.
아래 문자에서 다음 항목을 추출해 JSON만 출력하라. 설명·마크다운·코드펜스 금지.

주의: 사기범은 탐지를 피하려고 단어 사이에 쉼표·따옴표·공백을 넣는다(예: "자,,금" → "자금", "대'][출']" → "대출").
반드시 원래 단어로 복원한 뒤 추출하라.

{
 "claimed_program": "문자가 주장하는 지원사업·정책자금·상품의 정식 명칭(없으면 빈 문자열). 수식어 제외한 핵심 사업명만.",
 "claimed_org": "주장하는 소관·발신 기관명(없으면 빈 문자열)",
 "claimed_amount": "언급된 금액·한도·금리(없으면 빈 문자열)",
 "claimed_period": "언급된 접수기간·마감일(없으면 빈 문자열)",
 "is_policy_fund_claim": true/false,
 "requests_money": true/false,
 "requests_personal_info": true/false,
 "summary": "이 문자가 수신자에게 요구하는 행동을 한 문장으로"
}

문자:
"""
{{TEXT}}
"""`;

async function callGemini(prompt, key, timeoutMs = 9000) {
  const models = OK_MODEL ? [OK_MODEL, ...MODELS.filter((m) => m !== OK_MODEL)] : MODELS;
  let lastErr = "";

  const attempt = async (m, cfg) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: cfg,
          }),
        }
      );
      clearTimeout(timer);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { err: `${m}: HTTP ${r.status} ${String(body?.error?.message || "").slice(0, 160)}` };
      const txt = body?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") || "";
      if (!txt) return { err: `${m}: empty (finish=${body?.candidates?.[0]?.finishReason || "?"})` };
      return { text: txt };
    } catch (e) {
      clearTimeout(timer);
      return { err: `${m}: ${e.name === "AbortError" ? "timeout" : e.message}` };
    }
  };

  const BASE = { temperature: 0, responseMimeType: "application/json" };
  for (const m of models) {
    // A안 : 추론 최소화 + 충분한 출력 토큰
    let r = await attempt(m, { ...BASE, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } });
    if (r.text) { OK_MODEL = m; return { text: r.text, model: m }; }
    lastErr = r.err;

    // B안 : thinkingConfig 미지원 또는 응답 공백 시 재시도
    if (/HTTP 400|empty/.test(r.err)) {
      r = await attempt(m, { ...BASE, maxOutputTokens: 6144 });
      if (r.text) { OK_MODEL = m; return { text: r.text, model: m }; }
      lastErr = r.err;
    }
    // 429·404는 즉시 다음 모델로
  }
  throw new Error(lastErr || "gemini unavailable");
}

/* ---------------- handler ---------------- */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const raw = String(body.text || "").slice(0, 4000);
    if (raw.trim().length < 5)
      return res.status(400).json({ error: "판별할 문자 내용을 입력해 주십시오." });

    // 서버 2차 마스킹 (클라이언트 마스킹 실패 대비)
    const { text, masked } = maskPII(raw);

    // 1) 정보 추출
    let extracted, engine = "ai";
    const key = process.env.GEMINI_API_KEY;
    if (key) {
      try {
        const { text: out, model } = await callGemini(EXTRACT_PROMPT.replace("{{TEXT}}", text), key);
        extracted = JSON.parse(out.replace(/^```json|```$/g, "").trim());
        extracted._model = model;
      } catch (e) {
        extracted = heuristicExtract(text);
        engine = "fallback";
        extracted._error = String(e.message).slice(0, 300);
      }
    } else {
      extracted = heuristicExtract(text);
      engine = "rule";
    }

    // 2) 규칙 신호
    const signals = ruleSignals(text);

    // 3) 공고 대조 (스냅샷 → 미확인 시 최신 공고 실시간 보강)
    const D = db();
    let matches = matchProgram(extracted.claimed_program || "", D);
    if (!matches.length && extracted.claimed_program) {
      matches = matchProgram(text.slice(0, 120), D);
    }
    let liveUsed = false;
    if (!matches.length || matches[0].score < 0.55) {
      const live = await liveTopUp();
      if (live.length) {
        const lm = matchProgram(extracted.claimed_program || "", { items: live });
        if (lm.length && (!matches.length || lm[0].score > matches[0].score)) {
          matches = lm; liveUsed = true;
        }
      }
    }

    // 4) 판정
    const result = judge({ extracted, signals, matches });
    const guide = guidance(result.verdict, result.match);

    return res.status(200).json({
      ok: true,
      engine,
      engineNote: extracted._error || extracted._model || "",
      engineDetail: extracted._error ? String(extracted._error).slice(0, 300) : "",
      maskedFields: masked,
      extracted: {
        claimed_program: extracted.claimed_program || "",
        claimed_org: extracted.claimed_org || "",
        claimed_amount: extracted.claimed_amount || "",
        claimed_period: extracted.claimed_period || "",
        summary: extracted.summary || "",
      },
      verdict: result.verdict,
      risk: result.risk,
      reasons: result.reasons,
      match: result.match,
      candidates: result.candidates,
      guide,
      dataset: { syncedAt: D.syncedAt, count: D.count, live: liveUsed },
    });
  } catch (e) {
    return res.status(500).json({ error: "판별 처리 중 오류가 발생하였습니다.", detail: String(e.message).slice(0, 200) });
  }
}
