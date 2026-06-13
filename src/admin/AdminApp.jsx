import { useEffect, useMemo, useState } from "react";

// ────────────────────────────────────────────────────────────
// 관리자 대시보드
//  - 비밀번호 게이트 → /api/submissions (서버리스, service_role) 호출
//  - 설문 전·후 비교(점수 향상 + % 향상률) / 강사 만족도 / 주관식(키워드 군집) / CSV
//  - 기간(일자별) 필터 → 모든 통계가 선택 기간에 맞춰 재계산
//  - 데이터는 자기설명적 JSONB(survey)에서 직접 집계 → 문항이 바뀌어도 안전
// ────────────────────────────────────────────────────────────

const SS_KEY = "keiti_admin_pw"; // 새로고침 시 재입력 방지용 (sessionStorage, 탭 닫으면 사라짐)

export default function AdminApp() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(SS_KEY) || "");
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
const round1 = (v) => (v === null || v === undefined ? "—" : Math.round(v * 10) / 10);
const withSign = (v) => (typeof v === "number" && v > 0 ? `+${v}` : v);
// 상대 향상률(%) = (후 - 전) / 전 × 100
const pctImprove = (before, after) =>
  isNum(before) && isNum(after) && Number(before) > 0
    ? ((Number(after) - Number(before)) / Number(before)) * 100
    : null;
const pctLabel = (p) => (p === null ? "" : `${p > 0 ? "+" : ""}${Math.round(p)}%`);

const dayOf = (r) => (r.submitted_at || r.created_at || "").slice(0, 10);

function countBy(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const k = r[key] || "(미지정)";
    map.set(k, (map.get(k) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function aggregateTopics(rows, section) {
  const order = [];
  const acc = {};
  rows.forEach((r) => {
    const list = r.survey?.[section];
    if (!Array.isArray(list)) return;
    list.forEach((t) => {
      if (!acc[t.id]) {
        acc[t.id] = { id: t.id, label: t.label, sub: t.sub, befores: [], afters: [] };
        order.push(t.id);
      }
      if (isNum(t.before)) acc[t.id].befores.push(Number(t.before));
      if (isNum(t.after)) acc[t.id].afters.push(Number(t.after));
    });
  });
  return order.map((id) => {
    const a = acc[id];
    const avgBefore = mean(a.befores);
    const avgAfter = mean(a.afters);
    const avgDiff = avgBefore !== null && avgAfter !== null ? avgAfter - avgBefore : null;
    return {
      id,
      label: a.label || id,
      sub: a.sub || "",
      n: a.befores.length,
      avgBefore,
      avgAfter,
      avgDiff,
      pct: pctImprove(avgBefore, avgAfter),
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

function computeStats(rows) {
  const law = aggregateTopics(rows, "law");
  const exp = aggregateTopics(rows, "experience");
  const instructor = aggregateInstructor(rows);
  const instructorAvg = mean(instructor.map((q) => q.avg).filter((v) => v !== null));
  return {
    law,
    exp,
    instructor,
    instructorAvg,
    useful: collectFeedback(rows, "d1_useful"),
    improve: collectFeedback(rows, "d2_improve"),
    byDept: countBy(rows, "dept_name"),
    byForm: countBy(rows, "form_name"),
  };
}

// ── 주관식 키워드 추출 (유사 의견 군집용, 클라이언트 휴리스틱) ──
const KO_PARTICLES = [
  "으로써", "으로서", "에서는", "에게서", "으로", "로서", "로써", "에서", "에게", "한테",
  "까지", "부터", "보다", "처럼", "만큼", "마다", "조차", "마저", "밖에", "이나",
  "은", "는", "이", "가", "을", "를", "의", "에", "도", "와", "과", "로", "만", "들",
];
const STOPWORDS = new Set([
  "그리고", "하지만", "그러나", "그래서", "정말", "너무", "매우", "조금", "약간", "많이",
  "그냥", "특히", "또한", "또는", "그런", "이런", "저런", "대한", "관련", "통해", "위해",
  "대해", "있는", "없는", "같은", "좋은", "있다", "없다", "했다", "한다", "된다", "같다",
  "좋다", "좋았다", "좋았음", "좋음", "없음", "있음", "생각", "부분", "경우", "정도",
  "내용", "기능", "교육", "설문", "체험", "이번", "전체", "모두", "다른", "여러",
]);

function tokenSet(text) {
  const out = new Set();
  if (!text) return out;
  const raw = text.split(/[^가-힣a-zA-Z0-9]+/).filter(Boolean);
  for (let tok of raw) {
    tok = tok.toLowerCase();
    // 한글 토큰이면 끝에 붙은 조사 제거 (가장 긴 것부터)
    if (/[가-힣]$/.test(tok)) {
      for (const p of KO_PARTICLES) {
        if (tok.length > p.length + 1 && tok.endsWith(p)) {
          tok = tok.slice(0, -p.length);
          break;
        }
      }
    }
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

// 응답 N개에서 키워드별 "언급한 응답 수"(문서빈도) 집계 → 2건 이상만, 상위 12개
function keywordStats(items) {
  const counts = new Map();
  items.forEach((it) => {
    tokenSet(it.text).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
  });
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
}

// ────────────────────────────────────────────────────────────
// 대시보드 본체
// ────────────────────────────────────────────────────────────
function Dashboard({ rows, loading, error, onRefresh, onLogout }) {
  const allDays = useMemo(
    () => [...new Set(rows.map(dayOf).filter(Boolean))].sort(),
    [rows],
  );
  const minDay = allDays[0] || "";
  const maxDay = allDays[allDays.length - 1] || "";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const d = dayOf(r);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [rows, from, to],
  );

  const dailyCounts = useMemo(() => {
    const map = new Map(allDays.map((d) => [d, 0]));
    rows.forEach((r) => {
      const d = dayOf(r);
      if (map.has(d)) map.set(d, map.get(d) + 1);
    });
    return [...map.entries()];
  }, [rows, allDays]);

  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const total = filtered.length;
  const isFiltered = from || to;

  const selectDay = (d) => {
    setFrom(d);
    setTo(d);
  };
  const resetRange = () => {
    setFrom("");
    setTo("");
  };

  const avgLawDiff = mean(stats.law.map((t) => t.avgDiff));
  const avgLawPct = mean(stats.law.map((t) => t.pct));
  const avgExpDiff = mean(stats.exp.map((t) => t.avgDiff));
  const avgExpPct = mean(stats.exp.map((t) => t.pct));

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
            <button
              className="btn-csv"
              onClick={() => downloadCsv(filtered, stats, { from, to })}
              disabled={!total}
            >
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

        {/* ── 기간(일자별) 조회 ── */}
        <section className="panel filter-panel">
          <div className="filter-head">
            <h2 className="panel-title">기간 조회</h2>
            <div className="filter-controls">
              <input
                type="date"
                className="date-input"
                value={from}
                min={minDay}
                max={maxDay}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="date-sep">~</span>
              <input
                type="date"
                className="date-input"
                value={to}
                min={minDay}
                max={maxDay}
                onChange={(e) => setTo(e.target.value)}
              />
              <button className="btn-reset" onClick={resetRange} disabled={!isFiltered}>
                전체
              </button>
            </div>
          </div>
          <div className="filter-status">
            {isFiltered ? (
              <>
                <strong>{from || minDay}</strong> ~ <strong>{to || maxDay}</strong> · 표시{" "}
                <strong>{total}</strong>건 / 전체 {rows.length}건
              </>
            ) : (
              <>전체 기간 · {rows.length}건 (막대를 클릭하면 그 날짜만 조회)</>
            )}
          </div>
          <div className="daily-chart">
            {(() => {
              const max = Math.max(1, ...dailyCounts.map(([, c]) => c));
              return dailyCounts.map(([d, c]) => {
                const inRange = (!from || d >= from) && (!to || d <= to);
                return (
                  <button
                    key={d}
                    className={`daily-bar ${inRange ? "" : "dim"}`}
                    onClick={() => selectDay(d)}
                    title={`${d} · ${c}건`}
                  >
                    <span className="daily-count">{c}</span>
                    <span
                      className="daily-fill"
                      style={{ height: `${Math.max(6, (c / max) * 88)}px` }}
                    />
                    <span className="daily-label">{d.slice(5)}</span>
                  </button>
                );
              });
            })()}
          </div>
        </section>

        {total === 0 ? (
          <div className="empty-state">선택한 기간에 제출 데이터가 없습니다.</div>
        ) : (
          <>
            {/* 요약 카드 */}
            <section className="kpi-grid">
              <KpiCard label="제출 건수" value={total} unit="건" />
              <KpiCard label="강사 만족도 평균" value={round1(stats.instructorAvg)} unit="/ 5" accent />
              <KpiCard
                label="교육 이해도 평균 향상"
                value={withSign(round1(avgLawDiff))}
                unit="점"
                sub={pctLabel(avgLawPct)}
                positive
              />
              <KpiCard
                label="체험 인식 평균 향상"
                value={withSign(round1(avgExpDiff))}
                unit="점"
                sub={pctLabel(avgExpPct)}
                positive
              />
            </section>

            <BeforeAfterSection
              title="B. 교육 내용 이해도 — 전 · 후 비교"
              caption="교육 받기 전 대비 교육 후 이해 수준 (1~5점) · 향상점수와 향상률(%)"
              topics={stats.law}
            />

            <BeforeAfterSection
              title="C. 신고서 체험 인식 — 전 · 후 비교"
              caption="신고서 작성 체험 전 대비 후 (1~5점) · 향상점수와 향상률(%)"
              topics={stats.exp}
            />

            <section className="panel">
              <h2 className="panel-title">A. 강사 만족도</h2>
              <p className="panel-caption">문항별 평균 (1~5점)</p>
              <div className="bar-list">
                {stats.instructor.map((q) => (
                  <SingleBar key={q.id} label={q.question} value={q.avg} />
                ))}
              </div>
            </section>

            <section className="dist-grid">
              <DistCard title="소속별 제출" data={stats.byDept} total={total} />
              <DistCard title="신고서 유형별" data={stats.byForm} total={total} />
            </section>

            <section className="panel">
              <h2 className="panel-title">D. 주관식 응답</h2>
              <p className="panel-caption">
                키워드(유사 의견 묶음)별 언급 수를 먼저 보고, 키워드를 클릭하면 해당 의견만 모아 봅니다.
              </p>
              <div className="feedback-grid">
                <FeedbackColumn title="가장 유용했던 점" items={stats.useful} tone="useful" />
                <FeedbackColumn title="개선 의견" items={stats.improve} tone="improve" />
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

function KpiCard({ label, value, unit, sub, accent, positive }) {
  return (
    <div className={`kpi-card ${accent ? "accent" : ""} ${positive ? "positive" : ""}`}>
      <div className="kpi-value">
        {value}
        <span className="kpi-unit">{unit}</span>
        {sub ? <span className="kpi-sub">{sub}</span> : null}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

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
            <div className="ba-diffbox">
              <div className={`ba-diff ${diffClass(t.avgDiff)}`}>{withSign(round1(t.avgDiff))}점</div>
              <div className={`ba-pct ${diffClass(t.avgDiff)}`}>{pctLabel(t.pct)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function diffClass(d) {
  if (d === null || d === undefined) return "";
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

function SingleBar({ label, value }) {
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
  const [kw, setKw] = useState(null);
  const keywords = useMemo(() => keywordStats(items), [items]);
  const shown = useMemo(
    () => (kw ? items.filter((it) => tokenSet(it.text).has(kw)) : items),
    [kw, items],
  );
  const maxKw = Math.max(1, ...keywords.map(([, c]) => c));

  return (
    <div className={`fb-col ${tone}`}>
      <div className="fb-col-title">
        {title} <span className="fb-total">전체 {items.length}건</span>
      </div>

      {keywords.length > 0 && (
        <div className="kw-box">
          <div className="kw-box-title">키워드별 언급 수 (유사 의견)</div>
          <div className="kw-chips">
            {keywords.map(([word, count]) => (
              <button
                key={word}
                className={`kw-chip ${kw === word ? "active" : ""}`}
                onClick={() => setKw(kw === word ? null : word)}
                title={`'${word}' 포함 ${count}건`}
              >
                <span className="kw-bar" style={{ width: `${(count / maxKw) * 100}%` }} />
                <span className="kw-word">{word}</span>
                <span className="kw-count">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="fb-filter-status">
        {kw ? (
          <>
            키워드 <strong>'{kw}'</strong> 포함 {shown.length}건{" "}
            <button className="fb-clear" onClick={() => setKw(null)}>
              전체보기
            </button>
          </>
        ) : (
          <>전체 응답 {shown.length}건</>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="fb-empty">응답 없음</div>
      ) : (
        <ul className="fb-list">
          {shown.map((it, i) => (
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
// CSV 다운로드 (Excel 한글 대응: UTF-8 BOM) — 현재 필터된 데이터 기준
// ────────────────────────────────────────────────────────────
function downloadCsv(rows, stats, range) {
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
  const suffix = range && (range.from || range.to) ? `_${range.from || "처음"}~${range.to || "끝"}` : "";
  a.href = url;
  a.download = `keiti_제출결과${suffix}.csv`;
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
