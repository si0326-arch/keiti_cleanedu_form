# CLAUDE.md

KEITI 청렴 교육용 신고서 작성 체험 (Vite + React).
데이터 백엔드: **Supabase** (테이블 `public.submissions`). 호스팅: Vercel (main push 시 자동 배포). 소스: GitHub.

## 페이지 구성 (멀티페이지)
- `/` — 참여자용 신고서 작성·설문 제출 (`index.html` → `src/main.jsx` → `src/App.jsx`). anon 키로 INSERT.
- `/admin` — **관리자 결과 대시보드** (`admin.html` → `src/admin/main.jsx` → `src/admin/AdminApp.jsx`).
  설문 전·후 비교 통계 / 강사 만족도 / 주관식 응답 / CSV 다운로드.

## 관리자 대시보드 데이터 흐름 (중요)
`submissions` 는 RLS로 **anon 에 INSERT만** 허용 → 브라우저 anon 키로는 읽기 불가(개인정보 보호).
그래서 대시보드는 **서버리스 함수 `api/submissions.js`** 가 `service_role` 키로 RLS를 우회해 읽고,
**관리자 비밀번호**로 접근을 잠근다. 비밀번호·service_role 키는 **서버 환경변수에만** 둔다.

서버 전용 환경변수 (Vercel > Environment Variables, 로컬은 `vercel dev` + `.env`):
- `SUPABASE_URL` (VITE_ 없음), `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`
- ⚠️ 위 셋은 절대 `VITE_` 접두어를 붙이지 말 것(붙이면 브라우저 번들에 노출됨).

---

## 🔒 DB 변경 규칙 (STRICT — 반드시 지킬 것)

> 목적: **롤백·복구 가능 + 변경 이력 추적 + 재현 가능**.
> 즉석 명령으로 DB를 바꾸면 흔적이 안 남아 되돌릴 수 없다. 무조건 "파일로 남기고 → 실행"한다.

### 1. 스키마 변경 (테이블/컬럼/인덱스/정책의 생성·수정·삭제)
- **반드시** `supabase/migrations/` 에 마이그레이션 `.sql` 파일을 먼저 만든다.
- 그다음 **그 파일을 실행**한다: `node scripts/run-migration.mjs supabase/migrations/<파일>.sql`
- **금지**: psql/REST/콘솔 등으로 즉석 DDL을 직접 실행하는 것 (CREATE/ALTER/DROP을 파일 없이 날리지 말 것).

### 2. 데이터 변경 (행의 생성·수정·삭제 = INSERT/UPDATE/DELETE)
- 스키마와 **동일**하게, `supabase/migrations/` 에 마이그레이션 `.sql` 파일을 만들고 실행한다.
- **금지**: 즉석 명령/REST로 데이터를 직접 수정·삭제하는 것.
- 예외: 앱 런타임에서 사용자가 폼으로 만드는 정상 INSERT (anon insert)는 규칙 대상 아님. (운영/정리용 수동 변경만 마이그레이션으로)

### 마이그레이션 작성 규칙
- 파일명: `YYYYMMDDhhmmss_설명.sql` (시간순 정렬).
- 가능하면 멱등하게: `create table if not exists`, `drop policy if exists` 등.
- `.sql` 파일은 git에 커밋한다 (비밀 없음 — 변경 이력 보존).
- DB 접속 문자열은 **`.env.migration`(gitignore됨)** 의 `MIGRATION_DATABASE_URL` 에서 읽는다. 절대 코드/깃에 하드코딩하지 않는다.

---

## 보안
- 클라이언트엔 Supabase **anon/publishable 키만** 사용 (VITE_ 변수 = 공개되어도 됨, 보호는 RLS가 담당).
- `service_role` / DB 비밀번호 / 마이그레이션 접속 문자열은 **클라이언트·git에 절대 노출 금지**.
- 환경변수: `.env`(로컬, gitignore) / `.env.example`(템플릿, 커밋) / Vercel 대시보드.
