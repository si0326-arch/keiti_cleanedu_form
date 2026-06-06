-- KEITI 신고서 체험 — 제출 데이터 테이블
-- 동적/분기 설문에 대응하기 위해 report·survey 는 JSONB(통째 저장)로 둔다.
-- (고정 칼럼이 아니라 그때그때 답한 것만 저장 → 문항이 바뀌어도 스키마/데이터 안 깨짐)

create table if not exists public.submissions (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  emp_id         text,
  name           text,
  dept_id        text,
  dept_name      text,
  form_id        text,
  form_name      text,
  scenario_id    text,
  scenario_title text,
  survey_version text,                               -- 어느 버전 설문이었는지 추적
  report         jsonb not null default '{}'::jsonb, -- 신고서 답변 { field: {label, value} }
  survey         jsonb not null default '{}'::jsonb  -- 설문 답변 { qid: {question, value} }
);

-- 보안: RLS 켜기
alter table public.submissions enable row level security;

-- 익명 사용자는 insert(제출)만 가능. select/update/delete 정책 없음 → 키로 읽기 불가.
-- (관리자는 Supabase 대시보드 Table Editor 로 열람. 관리자 로그인은 추후 단계.)
drop policy if exists "anon can insert submissions" on public.submissions;
create policy "anon can insert submissions"
  on public.submissions
  for insert
  to anon
  with check (true);

-- 조회/분석용 인덱스
create index if not exists submissions_created_at_idx on public.submissions (created_at desc);
create index if not exists submissions_dept_id_idx   on public.submissions (dept_id);
create index if not exists submissions_form_id_idx   on public.submissions (form_id);
