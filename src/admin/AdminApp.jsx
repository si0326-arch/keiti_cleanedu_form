import { useEffect, useMemo, useState } from "react";

// ────────────────────────────────────────────────────────────
// 관리자 대시보드
//  - 비밀번호 게이트 → /api/submissions (서버리스, service_role) 호출
//  - 설문 전·후 비교 통계 / 강사 만족도 / 주관식 응답 / CSV 다운로드
//  - 데이터는 자기설명적 JSONB(survey)에서 직접 집계 → 문항이 바뀌어도 안전
// ────────────────────────────────────────────────────────────

const SS_KEY = "keiti_admin_pw"; // 새로고침 시 재입력 방지용 (sessionStorage, 탭 닫으면 사라짐)

export default function AdminApp() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(SS_KEY) || "");
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 세션에 비번이 남아있으면 자동 로그인 시도
  useEffect(() => {
    const saved = sessionStorage.getItem(SS_KEY);
    if (saved) fetchData(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchData(pw) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.status === 401) {
        setError("비밀번호가 올바르지 않습니다.");
        sessionStorage.removeItem(SS_KEY);
        setAuthed(false);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(`데이터를 불러오지 못했습니다. (${res.status}) ${j.detail || j.error || ""}`);
        return;
      }
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setAuthed(true);
      sessionStorage.setItem(SS_KEY, pw);
    } catch (e) {
      setError(
        "API 연결 실패. 로컬에서는 `vercel dev` 로 실행해야 /api 함수가 동작합니다. (배포 환경에선 정상)",
      );
    } finally {
      setLoading(false);
    }
  }

  const handleLogin = (e) => {
    e.preventDefault();
    if (password.trim()) fetchData(password.trim());
  };

  const logout = () => {
    sessionStorage.removeItem(SS_KEY);
    setAuthed(false);
    setRows([]);
    setPassword("");
  };

  if (!authed) {
    return (
      <LoginGate
        password={password}
        setPassword={setPassword}
        onSubmit={handleLogin}
        loading={loading}
        error={error}
      />
    );
  }

  return (
    <Dashboard
      rows={rows}
      loading={loading}
      error={error}
      onRefresh={() => fetchData(sessionStorage.getItem(SS_KEY))}
      onLogout={logout}
    />
  );
}

// ────────────────────────────────────────────────────────────
// 로그인 게이트
// ────────────────────────────────────────────────────────────
function LoginGate({ password, setPassword, onSubmit, loading, error }) {
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-logo">KEITI</div>
        <h1 className="login-title">제출 결과 대시보드</h1>
        <p className="login-sub">관리자 비밀번호를 입력하세요</p>
        <input
          className="login-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="관리자 비밀번호"
          autoFocus
          autoComplete="current-password"
        />
        {error && <div className="login-error">{error}</div>}
        <button className="login-btn" type="submit" disabled={loading || !password.trim()}>
          {loading ? "확인 중..." : "열람하기"}
        </button>
        <div className="login-foot">한국환경산업기술원 · 청렴 학습 · 관리자 전용</div>
      </form>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 집계 유틸
// ────────────────────────────────────────────────────────────
const isNum = (v) => v !== null && v !== undefined && v !== "" && !isNaN(Number(v));
const mean = (arr) => {
  const nums = arr.filter(isNum).map(Number);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};
const round1 = (v) => (v === null ? "—" : Math.round(v * 10) / 10);

function countBy(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const k = r[key] || "(미지정)";
    map.set(k, (map.get(k) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// 자기설명적 JSON에서 항목 순서/라벨을 수집하고 전·후 평균을 집계
function aggregateTopics(rows, section) {
  const order = [];
  const acc = {}; // id -> {label, sub, befores, afters, diffs}
  rows.forEach((r) => {
    const list = r.survey?.[section];
    if (!Array.isArray(list)) return;
    list.forEach((t) => {
      if (!acc[t.id]) {
        acc[t.id] = { id: t.id, label: t.label, sub: t.sub, befores: [], afters: [], diffs: [] };
        order.push(t.id);
      }
      if (isNum(t.before)) acc[t.id].befores.push(Number(t.before));
      if (isNum(t.after)) acc[t.id].afters.push(Number(t.after));
      const d =
        isNum(t.diff) ? Number(t.diff) : isNum(t.before) && isNum(t.after) ? t.after - t.before : null;
      if (d !== null) acc[t.id].diffs.push(d);
    });
  });
  return order.map((id) => {
    const a = acc[id];
    return {
      id,
      label: a.label || id,
      sub: a.sub || "",
      n: a.befores.length,
      avgBefore: mean(a.befores),
      avgAfter: mean(a.afters),
      avgDiff: mean(a.diffs),
    };
  });
}

function aggregateInstructor(rows) {
  const order = [];
  const acc = {};
  rows.forEach((r) => {
    const list = r.survey?.instructor;
    if (!Array.isArray(list)) return;
    list.forEach((q) => {
      if (!acc[q.id]) {
        acc[q.id] = { id: q.id, question: q.question, values: [] };
        order.push(q.id);
      }
      if (isNum(q.value)) acc[q.id].values.push(Number(q.value));
    });
  });
  return order.map((id) => ({
    id,
    question: acc[id].question || id,
    n: acc[id].values.length,
    avg: mean(acc[id].values),
  }));
}

function collectFeedback(rows, field) {
  return rows
    .map((r) => ({
      text: (r.survey?.feedback?.[field] || "").trim(),
      dept: r.dept_name || "(소속 미지정)",
      when: fmtDate(r.submitted_at || r.created_at),
    }))
    .filter((x) => x.text.length > 0);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

// ────────────────────────────────────────────────────────────
// 대시보드 본체
// ────────────────────────────────────────────────────────────
function Dashboard({ rows, loading, error, onRefresh, onLogout }) {
  const stats = useMemo(() => {
    const law = aggregateTopics(rows, "law");
    const exp = aggregateTopics(rows, "experience");
    const instructor = aggregateInstructor(rows);
    const instructorAvg = mean(instructor.map((q) => q.avg).filter((v) => v !== null));
    const useful = collectFeedback(rows, "d1_useful");
    const improve = collectFeedback(rows, "d2_improve");
    return {
      law,
      exp,
      instructor,
      instructorAvg,
      useful,
      improve,
      byDept: countBy(rows, "dept_name"),
      byForm: countBy(rows, "form_name"),
    };
  }, [rows]);

  const total = rows.length;

  return (
    <div className="dash">
      <header className="dash-header">
        <div className="dash-header-inner">
          <div className="dash-brand">
            <span className="dash-logo">KEITI</span>
            <div>
              <div className="dash-title">제출 결과 대시보드</div>
              <div className="dash-sub">청렴 학습 · 설문 효과성 분석</div>
            </div>
          </div>
          <div className="dash-actions">
            <button className="btn-soft" onClick={onRefresh} disabled={loading}>
              {loading ? "불러오는 중..." : "새로고침"}
            </button>
            <button className="btn-csv" onClick={() => downloadCsv(rows, stats)} disabled={!total}>
              CSV 다운로드
            </button>
            <button className="btn-ghost-sm" onClick={onLogout}>
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="dash-main">
        {error && <div className="dash-error">{error}</div>}

        {total === 0 ? (
          <div className="empty-state">아직 제출된 데이터가 없습니다.</div>
        ) : (
          <>
            {/* 요약 카드 */}
            <section className="kpi-grid">
              <KpiCard label="총 제출 건수" value={total} unit="건" />
              <KpiCard
                label="강사 만족도 평균"
                value={round1(stats.instructorAvg)}
                unit="/ 5"
                accent
              />
              <KpiCard
                label="교육 이해도 평균 향상"
                value={withSign(round1(mean(stats.law.map((t) => t.avgDiff))))}
                unit="점"
                positive
              />
              <KpiCard
                label="체험 인식 평균 향상"
                value={withSign(round1(mean(stats.exp.map((t) => t.avgDiff))))}
                unit="점"
                positive
              />
            </section>

            {/* B. 교육 이해도 전·후 */}
            <BeforeAfterSection
              title="B. 교육 내용 이해도 — 전 · 후 비교"
              caption="교육 받기 전 대비 교육 후 이해 수준 (1~5점)"
              topics={stats.law}
            />

            {/* C. 체험 인식 전·후 */}
            <BeforeAfterSection
              title="C. 신고서 체험 인식 — 전 · 후 비교"
              caption="신고서 작성 체험 전 대비 후 (1~5점)"
              topics={stats.exp}
            />

            {/* A. 강사 만족도 */}
            <section className="panel">
              <h2 className="panel-title">A. 강사 만족도</h2>
              <p className="panel-caption">문항별 평균 (1~5점)</p>
              <div className="bar-list">
                {stats.instructor.map((q) => (
                  <SingleBar key={q.id} label={q.question} value={q.avg} n={q.n} />
                ))}
              </div>
            </section>

            {/* 분포 */}
            <section className="dist-grid">
              <DistCard title="소속별 제출" data={stats.byDept} total={total} />
              <DistCard title="신고서 유형별" data={stats.byForm} total={total} />
            </section>

            {/* D. 주관식 */}
            <section className="panel">
              <h2 className="panel-title">D. 주관식 응답</h2>
              <div className="feedback-grid">
                <FeedbackColumn
                  title={`가장 유용했던 점 (${stats.useful.length})`}
                  items={stats.useful}
                  tone="useful"
                />
                <FeedbackColumn
                  title={`개선 의견 (${stats.improve.length})`}
                  items={stats.improve}
                  tone="improve"
                />
              </div>
            </section>
          </>
        )}
      </main>
      <footer className="dash-footer">
        © KEITI 한국환경산업기술원 · 관리자 전용 페이지 · 외부 공유 금지
      </footer>
    </div>
  );
}

const withSign = (v) => (typeof v === "number" && v > 0 ? `+${v}` : v);

function KpiCard({ label, value, unit, accent, positive }) {
  return (
    <div className={`kpi-card ${accent ? "accent" : ""} ${positive ? "positive" : ""}`}>
      <div className="kpi-value">
        {value}
        <span className="kpi-unit">{unit}</span>
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

// 전·후 비교 섹션 (항목별 before/after 막대 + 향상 배지)
function BeforeAfterSection({ title, caption, topics }) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      <p className="panel-caption">{caption}</p>
      <div className="ba-list">
        {topics.map((t) => (
          <div key={t.id} className="ba-row">
            <div className="ba-meta">
              <div className="ba-label">{t.label}</div>
              {t.sub && <div className="ba-sub">{t.sub}</div>}
            </div>
            <div className="ba-bars">
              <BAItem tag="전" value={t.avgBefore} kind="before" />
              <BAItem tag="후" value={t.avgAfter} kind="after" />
            </div>
            <div className={`ba-diff ${diffClass(t.avgDiff)}`}>{withSign(round1(t.avgDiff))}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function diffClass(d) {
  if (d === null) return "";
  if (d > 0) return "up";
  if (d < 0) return "down";
  return "flat";
}

function BAItem({ tag, value, kind }) {
  const pct = value === null ? 0 : (value / 5) * 100;
  return (
    <div className="ba-item">
      <span className="ba-tag">{tag}</span>
      <div className="ba-track">
        <div className={`ba-fill ${kind}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="ba-val">{round1(value)}</span>
    </div>
  );
}

function SingleBar({ label, value, n }) {
  const pct = value === null ? 0 : (value / 5) * 100;
  return (
    <div className="sb-row">
      <div className="sb-label" title={label}>
        {label}
      </div>
      <div className="sb-track">
        <div className="sb-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="sb-val">{round1(value)}</div>
    </div>
  );
}

function DistCard({ title, data, total }) {
  return (
    <div className="panel dist-card">
      <h3 className="dist-title">{title}</h3>
      <div className="dist-list">
        {data.map(([name, count]) => (
          <div key={name} className="dist-row">
            <span className="dist-name" title={name}>
              {name}
            </span>
            <div className="dist-bar-track">
              <div className="dist-bar-fill" style={{ width: `${(count / total) * 100}%` }} />
            </div>
            <span className="dist-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedbackColumn({ title, items, tone }) {
  return (
    <div className={`fb-col ${tone}`}>
      <div className="fb-col-title">{title}</div>
      {items.length === 0 ? (
        <div className="fb-empty">응답 없음</div>
      ) : (
        <ul className="fb-list">
          {items.map((it, i) => (
            <li key={i} className="fb-item">
              <div className="fb-text">{it.text}</div>
              <div className="fb-meta">
                {it.dept} · {it.when}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// CSV 다운로드 (Excel 한글 대응: UTF-8 BOM)
// ────────────────────────────────────────────────────────────
function downloadCsv(rows, stats) {
  const instrIds = stats.instructor.map((q) => q.id);
  const instrLabel = Object.fromEntries(stats.instructor.map((q, i) => [q.id, `강사Q${i + 1}`]));
  const lawTopics = stats.law;
  const expTopics = stats.exp;

  const header = [
    "제출일시",
    "사번",
    "이름",
    "소속",
    "신고서",
    "시나리오",
    ...instrIds.map((id) => instrLabel[id]),
    "강사평균",
    ...lawTopics.flatMap((t) => [`${t.label}_전`, `${t.label}_후`, `${t.label}_향상`]),
    ...expTopics.flatMap((t) => [`${t.label}_전`, `${t.label}_후`, `${t.label}_향상`]),
    "D1_유용했던점",
    "D2_개선의견",
  ];

  const lines = [header];

  rows.forEach((r) => {
    const instr = indexBy(r.survey?.instructor, "id");
    const law = indexBy(r.survey?.law, "id");
    const exp = indexBy(r.survey?.experience, "id");
    const instrVals = instrIds.map((id) => instr[id]?.value ?? "");
    const instrAvg = mean(instrVals);

    const line = [
      fmtDate(r.submitted_at || r.created_at),
      r.emp_id || "",
      r.name || "",
      r.dept_name || "",
      r.form_name || "",
      r.scenario_title || "",
      ...instrVals,
      instrAvg === null ? "" : round1(instrAvg),
      ...lawTopics.flatMap((t) => topicCells(law[t.id])),
      ...expTopics.flatMap((t) => topicCells(exp[t.id])),
      r.survey?.feedback?.d1_useful || "",
      r.survey?.feedback?.d2_improve || "",
    ];
    lines.push(line);
  });

  const csv = "﻿" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = fmtDate(new Date().toISOString()).replace(/[^\d]/g, "").slice(0, 12);
  a.href = url;
  a.download = `keiti_제출결과_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function topicCells(t) {
  if (!t) return ["", "", ""];
  const before = t.before ?? "";
  const after = t.after ?? "";
  const diff = isNum(t.diff) ? t.diff : isNum(t.before) && isNum(t.after) ? t.after - t.before : "";
  return [before, after, diff];
}

function indexBy(arr, key) {
  const out = {};
  if (Array.isArray(arr)) arr.forEach((x) => (out[x[key]] = x));
  return out;
}

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
