// Vercel 서버리스 함수 — 관리자 비밀번호로 보호되는 제출 데이터 조회 API
//
// 왜 서버리스인가:
//   submissions 테이블은 RLS로 anon 키엔 INSERT만 허용한다(개인정보 보호).
//   따라서 브라우저에 노출되는 anon 키로는 데이터를 읽을 수 없다.
//   이 함수가 service_role 키로 RLS를 우회해 읽고, 관리자 비밀번호로 접근을 잠근다.
//   service_role 키와 비밀번호는 서버 환경변수에만 존재 → 브라우저·git에 절대 노출 안 됨.
//
// 필요한 서버 환경변수 (Vercel > Settings > Environment Variables, 로컬은 .env):
//   SUPABASE_URL                : https://xxxx.supabase.co   (VITE_ 접두어 없음!)
//   SUPABASE_SERVICE_ROLE_KEY   : service_role 키            (절대 공개 금지)
//   ADMIN_PASSWORD              : 대시보드 접근 비밀번호

import { createHash, timingSafeEqual } from "node:crypto";

// 길이까지 숨기는 상수시간 비교 (입력을 SHA-256으로 고정길이화한 뒤 비교)
function passwordMatches(input, secret) {
  const a = createHash("sha256").update(String(input)).digest();
  const b = createHash("sha256").update(String(secret)).digest();
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // 환경변수 값에 실수로 끼어든 공백/개행 제거 (URL·키엔 공백이 없어야 함).
  // 예: 붙여넣기 중 "supaba se.co" 처럼 도메인에 공백이 들어가면 fetch가 깨진다.
  const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!SUPABASE_URL || !SERVICE_KEY || !ADMIN_PASSWORD) {
    return res.status(500).json({
      error: "server_misconfigured",
      detail:
        "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ADMIN_PASSWORD 환경변수를 확인하세요.",
    });
  }

  // body 파싱 (Vercel이 보통 자동 파싱하지만 문자열로 올 때도 방어)
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const password = body && body.password ? body.password : "";

  if (!passwordMatches(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const base = SUPABASE_URL.replace(/\/$/, "");
    const url = `${base}/rest/v1/submissions?select=*&order=created_at.desc`;
    const r = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!r.ok) {
      const text = await r.text();
      return res
        .status(502)
        .json({ error: "supabase_error", status: r.status, detail: text.slice(0, 500) });
    }
    const rows = await r.json();
    // 캐시 금지 (개인정보)
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ rows, count: rows.length });
  } catch (e) {
    return res.status(500).json({ error: "fetch_failed", detail: String(e).slice(0, 500) });
  }
}
