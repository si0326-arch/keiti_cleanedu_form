import { createClient } from "@supabase/supabase-js";

// 환경변수에서 주입 (VITE_ 접두어 → 클라이언트 번들에 포함됨).
// anon/publishable 키는 공개돼도 안전 — 실제 보호는 DB의 RLS 정책이 담당한다.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. (.env 또는 Vercel 환경변수 확인)"
  );
}

// 키가 없으면 null → 제출 시 친절한 오류 메시지로 처리 (화면 크래시 방지)
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
