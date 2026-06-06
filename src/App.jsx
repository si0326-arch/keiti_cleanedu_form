import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import {
  DEPARTMENTS,
  FORMS,
  STEPS,
  SCALE_LABELS,
  INSTRUCTOR_QUESTIONS,
  LAW_TOPICS,
  EXPERIENCE_TOPICS,
  REQUIRED_SURVEY_IDS,
  SURVEY_VERSION,
  getFormRecommendations,
} from "./data";

// ────────────────────────────────────────────────────────────
// 메인 앱: 단계(스텝) 상태 관리 + 화면 라우팅 + 최종 제출
// ────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);
  const [empId, setEmpId] = useState("");
  const [name, setName] = useState("");
  const [deptId, setDeptId] = useState("");
  const [selectedFormRec, setSelectedFormRec] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [confirmChecks, setConfirmChecks] = useState({});
  const [surveyAnswers, setSurveyAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // 단계가 바뀔 때마다 화면 상단으로 부드럽게 스크롤
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goPrev = () => setStep((s) => Math.max(s - 1, 0));
  const reset = () => {
    setStep(0);
    setEmpId("");
    setName("");
    setDeptId("");
    setSelectedFormRec(null);
    setSelectedScenario(null);
    setFormValues({});
    setConfirmChecks({});
    setSurveyAnswers({});
    setSubmitError("");
  };

  // 추천 신고서가 갑질행위 대응(formIdOverride)인 경우 해당 양식을, 그 외에는
  // 선택한 시나리오의 양식을 사용한다.
  const resolvedFormId = selectedScenario
    ? selectedFormRec?.formIdOverride || selectedScenario.formId
    : null;
  const form = resolvedFormId ? FORMS[resolvedFormId] : null;
  const deptName = DEPARTMENTS.find((d) => d.id === deptId)?.name;

  // 작성 화면에서 "다음" → 설문 단계로 이동 (실제 전송은 설문 제출 시)
  const handleWriteNext = () => {
    goNext();
  };

  // 설문까지 마친 뒤 최종 제출: 신고 내용 + 설문 응답을 Supabase 에 저장
  const handleSubmit = async () => {
    if (!supabase) {
      setSubmitError("DB 설정이 누락되었습니다. 관리자에게 문의해주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");

    // 신고서 답변: 직접 입력이 있으면 우선, 없으면 작성예시. 항목 라벨도 함께 저장(자기설명).
    const report = {};
    if (form) {
      form.fields.forEach((field) => {
        const userInput = (formValues[field.id] || "").trim();
        const example = selectedScenario.examples[field.id] || "";
        report[field.id] = { label: field.label, value: userInput || example };
      });
    }

    // 설문 응답: 질문 텍스트와 함께 저장(자기설명) → 문항이 바뀌어도 과거 응답을 해석 가능
    const scoredTopic = (t) => {
      const before = surveyAnswers[`${t.id}_before`] ?? null;
      const after = surveyAnswers[`${t.id}_after`] ?? null;
      return {
        id: t.id,
        label: t.label,
        sub: t.sub,
        before,
        after,
        diff: before != null && after != null ? after - before : null,
      };
    };
    const survey = {
      instructor: INSTRUCTOR_QUESTIONS.map((q) => ({
        id: q.id,
        question: q.text,
        value: surveyAnswers[q.id] ?? null,
      })),
      law: LAW_TOPICS.map(scoredTopic),
      experience: EXPERIENCE_TOPICS.map(scoredTopic),
      feedback: {
        d1_useful: surveyAnswers.d1_useful || "",
        d2_improve: surveyAnswers.d2_improve || "",
      },
    };

    const row = {
      emp_id: empId,
      name,
      dept_id: deptId,
      dept_name: deptName || "",
      form_id: resolvedFormId,
      form_name: form?.name || "",
      scenario_id: selectedScenario?.id || "",
      scenario_title: selectedScenario?.title || "",
      survey_version: SURVEY_VERSION,
      report,
      survey,
      submitted_at: new Date().toISOString(),
    };

    try {
      const { error } = await supabase.from("submissions").insert(row);
      if (error) throw error;
      goNext();
    } catch (e) {
      console.error("[제출 실패]", e);
      setSubmitError("제출 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      <Header />
      <Stepper current={step} />
      <main className="main">
        {step === 0 && <StartScreen onNext={goNext} />}
        {step === 1 && (
          <IdentityScreen
            empId={empId}
            name={name}
            setEmpId={setEmpId}
            setName={setName}
            onNext={goNext}
            onPrev={goPrev}
          />
        )}
        {step === 2 && (
          <DeptScreen
            deptId={deptId}
            setDeptId={setDeptId}
            selectedFormRec={selectedFormRec}
            setSelectedFormRec={setSelectedFormRec}
            onNext={goNext}
            onPrev={goPrev}
          />
        )}
        {step === 3 && (
          <ScenarioScreen
            formRec={selectedFormRec}
            selectedScenario={selectedScenario}
            setSelectedScenario={setSelectedScenario}
            onNext={goNext}
            onPrev={goPrev}
          />
        )}
        {step === 4 && form && selectedScenario && (
          <WriteScreen
            form={form}
            scenario={selectedScenario}
            formValues={formValues}
            setFormValues={setFormValues}
            confirmChecks={confirmChecks}
            setConfirmChecks={setConfirmChecks}
            onSubmit={handleWriteNext}
            onPrev={goPrev}
            submitting={false}
            submitError=""
            empId={empId}
            name={name}
            deptName={deptName}
          />
        )}
        {step === 5 && (
          <SurveyScreen
            surveyAnswers={surveyAnswers}
            setSurveyAnswers={setSurveyAnswers}
            onSubmit={handleSubmit}
            onPrev={goPrev}
            submitting={submitting}
            submitError={submitError}
          />
        )}
        {step === 6 && (
          <DoneScreen
            empId={empId}
            name={name}
            deptName={deptName}
            formName={form?.name}
            scenarioTitle={selectedScenario?.title}
            onReset={reset}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 상단 헤더
// ────────────────────────────────────────────────────────────
function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-logo">
          <span className="logo-mark">KEITI</span>
        </div>
        <div className="header-text">
          <div className="header-title">신고서 작성 체험</div>
          <div className="header-sub">한국환경산업기술원 · 청렴 학습</div>
        </div>
      </div>
    </header>
  );
}

// ────────────────────────────────────────────────────────────
// 진행 단계 표시(스텝퍼)
// ────────────────────────────────────────────────────────────
function Stepper({ current }) {
  return (
    <div className="stepper">
      {STEPS.map((step, index) => (
        <div
          key={step.key}
          className={`step ${index === current ? "active" : ""} ${index < current ? "done" : ""}`}
        >
          <div className="step-dot">{index < current ? "✓" : index + 1}</div>
          <div className="step-label">{step.label}</div>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 0. 시작 화면
// ────────────────────────────────────────────────────────────
function StartScreen({ onNext }) {
  return (
    <div className="screen">
      <div className="hero">
        <div className="hero-eyebrow">청렴 학습 시뮬레이션</div>
        <h1 className="hero-title">
          신고서, <span className="accent">직접</span> 써보면
          <br />
          이해됩니다
        </h1>
        <p className="hero-desc">
          청탁금지법·이해충돌방지법·갑질방지 등
          <br />
          KEITI 임직원이 알아야 할 청렴 신고서를
          <br />
          시나리오와 함께 체험해보세요.
        </p>
        <div className="hero-info">
          <div className="info-row">
            <span className="info-icon">①</span>
            <span>소속 처·단을 선택하면 1순위 부패위험에 맞는 추천 신고서가 안내됩니다</span>
          </div>
          <div className="info-row">
            <span className="info-icon">②</span>
            <span>시나리오 2개 중 하나를 골라 상황을 확인합니다</span>
          </div>
          <div className="info-row">
            <span className="info-icon">③</span>
            <span>작성예시를 확인하고 그대로 또는 본인 표현으로 제출합니다</span>
          </div>
        </div>
        <button className="btn-primary btn-large" onClick={onNext}>
          시작하기
        </button>
        <div className="hero-foot">📚 권익위 사례집·이충법 유권해석집·청탁금지법 결정례 기반</div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 1. 참여자 정보 (사번 6자리 + 이름)
// ────────────────────────────────────────────────────────────
function IdentityScreen({ empId, name, setEmpId, setName, onNext, onPrev }) {
  const empIdValid = /^\d{6}$/.test(empId);
  const canProceed = empIdValid && name.trim().length > 0;
  const handleEmpIdChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    setEmpId(digits);
  };

  return (
    <div className="screen">
      <h2 className="screen-title">참여자 정보</h2>
      <p className="screen-sub">
        출석 확인용 사번·이름만 입력합니다 (개인정보는 학습 출석 확인 외에 사용되지 않음)
      </p>
      <div className="card">
        <label className="field-label">
          사번 <span className="field-hint">(숫자 6자리)</span>
        </label>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={empId}
          onChange={handleEmpIdChange}
          placeholder="예: 123456"
          autoFocus
        />
        {empId.length > 0 && !empIdValid && (
          <div className="input-error">사번은 숫자 6자리로 입력해주세요 ({empId.length}/6)</div>
        )}
        <label className="field-label" style={{ marginTop: 16 }}>
          이름
        </label>
        <input
          className="input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 홍길동"
        />
        <div className="note">※ 주민번호, 연락처 등 그 외 정보는 수집하지 않습니다.</div>
      </div>
      <div className="btn-row">
        <button className="btn-ghost" onClick={onPrev}>
          이전
        </button>
        <button className="btn-primary" onClick={onNext} disabled={!canProceed}>
          다음
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 2. 소속 처·단 선택 + 추천 신고서
// ────────────────────────────────────────────────────────────
function DeptScreen({ deptId, setDeptId, selectedFormRec, setSelectedFormRec, onNext, onPrev }) {
  const recommendations = deptId ? getFormRecommendations(deptId) : [];

  return (
    <div className="screen">
      <h2 className="screen-title">소속 처·단 선택</h2>
      <p className="screen-sub">소속을 고르면 1순위 부패위험에 맞는 추천 신고서가 표시됩니다</p>
      <div className="dept-grid">
        {DEPARTMENTS.map((dept) => (
          <button
            key={dept.id}
            className={`dept-tile ${deptId === dept.id ? "selected" : ""}`}
            onClick={() => {
              setDeptId(dept.id);
              setSelectedFormRec(null);
            }}
          >
            <div className="dept-name">{dept.name}</div>
            <div className="dept-risk">
              <span className="risk-tag">1순위: {dept.primaryRisk}</span>
            </div>
          </button>
        ))}
      </div>
      {deptId && (
        <>
          <div className="divider">
            <span className="divider-text">추천 신고서</span>
          </div>
          <div className="form-list">
            {recommendations.map((rec) => (
              <button
                key={rec.formKey}
                className={`form-rec ${selectedFormRec?.formKey === rec.formKey ? "selected" : ""} ${
                  rec.isPrimary ? "primary" : "common"
                }`}
                onClick={() => setSelectedFormRec(rec)}
              >
                <div className="form-rec-tag">
                  {rec.isPrimary ? "★ 처·단 1순위 추천" : "◆ 전사 공통 추천"}
                </div>
                <div className="form-rec-name">{rec.formName}</div>
                <div className="form-rec-desc">{rec.formDesc}</div>
                <div className="form-rec-reason">{rec.reason}</div>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="btn-row">
        <button className="btn-ghost" onClick={onPrev}>
          이전
        </button>
        <button className="btn-primary" onClick={onNext} disabled={!deptId || !selectedFormRec}>
          시나리오 보기
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 3. 시나리오 선택
// ────────────────────────────────────────────────────────────
function ScenarioScreen({ formRec, selectedScenario, setSelectedScenario, onNext, onPrev }) {
  if (!formRec) return null;

  return (
    <div className="screen">
      <h2 className="screen-title">시나리오 선택</h2>
      <p className="screen-sub">
        <strong>{formRec.formName}</strong>로 작성할 시나리오를 하나 선택하세요
      </p>
      <div className="scenario-list">
        {formRec.scenarios.map((scenario, index) => (
          <button
            key={scenario.id}
            className={`scenario-card ${selectedScenario?.id === scenario.id ? "selected" : ""}`}
            onClick={() => setSelectedScenario(scenario)}
          >
            <div className="scenario-label">시나리오 {index === 0 ? "A" : "B"}</div>
            <div className="scenario-title">{scenario.title}</div>
            <div className="scenario-situation">{scenario.situation}</div>
            <div className="scenario-ref">📚 참고: {scenario.refSource}</div>
          </button>
        ))}
      </div>
      <div className="btn-row">
        <button className="btn-ghost" onClick={onPrev}>
          이전
        </button>
        <button className="btn-primary" onClick={onNext} disabled={!selectedScenario}>
          작성하기
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 4. 신고서 작성 (항목별 작성예시 확인 또는 직접 입력)
// ────────────────────────────────────────────────────────────
function WriteScreen({
  form,
  scenario,
  formValues,
  setFormValues,
  confirmChecks,
  setConfirmChecks,
  onSubmit,
  onPrev,
  submitting,
  submitError,
  empId,
  name,
  deptName,
}) {
  // 모든 항목이 [예시 그대로 사용] 체크되었거나 직접 입력되어야 제출 가능
  const canSubmit = form.fields.every((field) => {
    const checked = confirmChecks[field.id];
    const typed = (formValues[field.id] || "").trim();
    return checked || typed.length > 0;
  });
  const toggleConfirm = (id) => {
    setConfirmChecks({ ...confirmChecks, [id]: !confirmChecks[id] });
  };
  const setFieldValue = (id, value) => {
    setFormValues({ ...formValues, [id]: value });
  };

  return (
    <div className="screen">
      <div className="form-header">
        <div className="form-header-tag">{form.subtitle}</div>
        <h2 className="form-title">{form.name}</h2>
      </div>
      <div className="scenario-summary">
        <div className="scenario-summary-tag">선택한 시나리오</div>
        <div className="scenario-summary-title">{scenario.title}</div>
        <div className="scenario-summary-text">{scenario.situation}</div>
      </div>
      <div className="card">
        <div className="card-tag">신고자 정보</div>
        <div className="identity-row">
          <div className="identity-item">
            <div className="identity-label">사번</div>
            <div className="identity-value">{empId}</div>
          </div>
          <div className="identity-item">
            <div className="identity-label">성명</div>
            <div className="identity-value">{name}</div>
          </div>
          <div className="identity-item">
            <div className="identity-label">소속</div>
            <div className="identity-value">{deptName}</div>
          </div>
          <div className="identity-item">
            <div className="identity-label">주민번호</div>
            <div className="identity-value muted">생략</div>
          </div>
          <div className="identity-item">
            <div className="identity-label">연락처</div>
            <div className="identity-value muted">생략</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-tag">신고 내용</div>
        <p className="write-guide">
          각 항목의 <strong>작성예시</strong>를 확인하고, 그대로 사용하려면{" "}
          <strong>✓ 확인 체크박스</strong>를 클릭하세요. 수정하고 싶으면 아래 입력칸에 직접 작성하면
          됩니다. (직접 입력한 내용이 우선 저장됩니다)
        </p>
        {form.fields.map((field) => {
          const example = scenario.examples[field.id] || "";
          const checked = !!confirmChecks[field.id];
          const typed = formValues[field.id] || "";
          return (
            <div key={field.id} className="field-block">
              <div className="field-label-big">{field.label}</div>
              <div className="example-box">
                <div className="example-tag">📝 작성예시</div>
                <div className="example-text">{example}</div>
              </div>
              <label className={`confirm-row ${checked ? "checked" : ""}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleConfirm(field.id)} />
                <span>위 예시 그대로 제출에 사용</span>
              </label>
              <textarea
                className="custom-input"
                value={typed}
                onChange={(e) => setFieldValue(field.id, e.target.value)}
                placeholder="수정하고 싶으면 여기에 직접 입력 (입력 시 예시보다 우선)"
                rows={2}
              />
            </div>
          );
        })}
      </div>
      {submitError && <div className="error-msg">{submitError}</div>}
      <div className="btn-row">
        <button className="btn-ghost" onClick={onPrev} disabled={submitting}>
          이전
        </button>
        <button
          className="btn-primary btn-submit"
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
        >
          다음 (설문 응답)
        </button>
      </div>
      {!canSubmit && (
        <div className="hint">
          ※ 모든 항목에 대해 [예시 그대로 사용] 체크 또는 직접 입력해주세요
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 설문 공통: 1~5점 척도 한 줄
// ────────────────────────────────────────────────────────────
function ScaleRow({ qId, value, onChange }) {
  return (
    <div className="scale-row">
      {SCALE_LABELS.map((label, index) => {
        const score = index + 1;
        return (
          <label key={score} className={`scale-option ${value === score ? "selected" : ""}`}>
            <input
              type="radio"
              name={qId}
              value={score}
              checked={value === score}
              onChange={() => onChange(score)}
            />
            <div className="scale-num">{score}</div>
            <div className="scale-label">{label}</div>
          </label>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 5. 학습 효과성 설문 (A 강사 / B 법령 전·후 / C 체험 전·후 / D 주관식)
// ────────────────────────────────────────────────────────────
function SurveyScreen({ surveyAnswers, setSurveyAnswers, onSubmit, onPrev, submitting, submitError }) {
  const setAnswer = (id, value) => {
    setSurveyAnswers({ ...surveyAnswers, [id]: value });
  };
  const answeredCount = REQUIRED_SURVEY_IDS.filter((id) => surveyAnswers[id]).length;
  const progress = Math.round((answeredCount / REQUIRED_SURVEY_IDS.length) * 100);
  const allRequiredAnswered = answeredCount === REQUIRED_SURVEY_IDS.length;

  return (
    <div className="screen">
      <h2 className="screen-title">학습 효과성 설문</h2>
      <p className="screen-sub">
        법정대면교육 및 신고서 작성 체험의 효과 측정을 위한 설문입니다. A·B·C는{" "}
        <strong>필수</strong>, D는 선택 응답입니다.
      </p>
      <div className="survey-progress-bar">
        <div className="survey-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="card">
        <div className="card-tag">
          A. 강사 만족도<span className="required-badge">필수</span>
        </div>
        {INSTRUCTOR_QUESTIONS.map((question, index) => (
          <div key={question.id} className="survey-block">
            <div className="survey-question">
              <span className="survey-num">{index + 1}</span>
              <span className="survey-text">{question.text}</span>
            </div>
            <ScaleRow
              qId={question.id}
              value={surveyAnswers[question.id]}
              onChange={(v) => setAnswer(question.id, v)}
            />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-tag">
          B. 교육 내용 이해도 전·후 비교<span className="required-badge">필수</span>
        </div>
        <p className="survey-guide">
          교육 <strong>받기 전</strong>과 <strong>지금(교육 후)</strong> 이해 수준을 각각 1~5점으로
          응답해주세요.
        </p>
        <div className="compare-table-wrap">
          <table className="compare-table compare-table-3col">
            <thead>
              <tr>
                <th className="compare-th-q">법령·주제</th>
                <th className="compare-th-scale before-col">교육 전</th>
                <th className="compare-th-scale after-col">교육 후</th>
              </tr>
            </thead>
            <tbody>
              {LAW_TOPICS.map((topic) => (
                <tr key={topic.id}>
                  <td className="compare-td-q">
                    <div className="compare-q-label">{topic.label}</div>
                    <div className="compare-q-sub">{topic.sub}</div>
                  </td>
                  <td className="compare-td-scale">
                    <ScaleRow
                      qId={`${topic.id}_before`}
                      value={surveyAnswers[`${topic.id}_before`]}
                      onChange={(v) => setAnswer(`${topic.id}_before`, v)}
                    />
                  </td>
                  <td className="compare-td-scale">
                    <ScaleRow
                      qId={`${topic.id}_after`}
                      value={surveyAnswers[`${topic.id}_after`]}
                      onChange={(v) => setAnswer(`${topic.id}_after`, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-tag">
          C. 신고서 체험 인식 변화<span className="required-badge">필수</span>
        </div>
        <p className="survey-guide">
          신고서 제출 체험 <strong>시작 전</strong>과 <strong>지금</strong>의 수준을 각각
          응답해주세요.
        </p>
        <div className="compare-table-wrap">
          <table className="compare-table compare-table-3col">
            <thead>
              <tr>
                <th className="compare-th-q">항목</th>
                <th className="compare-th-scale before-col">체험 전</th>
                <th className="compare-th-scale after-col">체험 후</th>
              </tr>
            </thead>
            <tbody>
              {EXPERIENCE_TOPICS.map((topic) => (
                <tr key={topic.id}>
                  <td className="compare-td-q">
                    <div className="compare-q-label">{topic.label}</div>
                    <div className="compare-q-sub">{topic.sub}</div>
                  </td>
                  <td className="compare-td-scale">
                    <ScaleRow
                      qId={`${topic.id}_before`}
                      value={surveyAnswers[`${topic.id}_before`]}
                      onChange={(v) => setAnswer(`${topic.id}_before`, v)}
                    />
                  </td>
                  <td className="compare-td-scale">
                    <ScaleRow
                      qId={`${topic.id}_after`}
                      value={surveyAnswers[`${topic.id}_after`]}
                      onChange={(v) => setAnswer(`${topic.id}_after`, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-tag">
          D. 시스템 피드백<span className="optional-badge">선택</span>
        </div>
        <div className="survey-block">
          <div className="survey-question">
            <span className="survey-num optional">①</span>
            <span className="survey-text">
              시스템에서 가장 유용했던 기능이나 콘텐츠는 무엇이었나요?
            </span>
          </div>
          <textarea
            className="custom-input survey-textarea"
            value={surveyAnswers.d1_useful || ""}
            onChange={(e) => setAnswer("d1_useful", e.target.value)}
            placeholder="예: 시나리오 사례가 실제 업무와 비슷해 도움이 됐다, 작성예시 체크 방식이 편했다 등 (선택 응답)"
            rows={3}
          />
        </div>
        <div className="survey-block" style={{ marginBottom: 0 }}>
          <div className="survey-question">
            <span className="survey-num optional">②</span>
            <span className="survey-text">
              개선이 필요하다고 느낀 부분이 있다면 자유롭게 작성해주세요.
            </span>
          </div>
          <textarea
            className="custom-input survey-textarea"
            value={surveyAnswers.d2_improve || ""}
            onChange={(e) => setAnswer("d2_improve", e.target.value)}
            placeholder="예: 시나리오를 더 추가했으면, 안내 문구가 더 상세했으면 등 (선택 응답)"
            rows={3}
          />
        </div>
      </div>

      {submitError && <div className="error-msg">{submitError}</div>}
      <div className="btn-row">
        <button className="btn-ghost" onClick={onPrev} disabled={submitting}>
          이전
        </button>
        <button
          className="btn-primary btn-submit"
          onClick={onSubmit}
          disabled={!allRequiredAnswered || submitting}
        >
          {submitting ? "제출 중..." : "제출하기"}
        </button>
      </div>
      {!allRequiredAnswered && (
        <div className="hint">
          ※ 필수 응답(A·B·C 섹션) {answeredCount}/{REQUIRED_SURVEY_IDS.length}개 완료. 모두
          응답해주세요.
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 6. 완료 화면
// ────────────────────────────────────────────────────────────
function DoneScreen({ empId, name, deptName, formName, scenarioTitle, onReset }) {
  return (
    <div className="screen">
      <div className="done-container">
        <div className="done-stamp">
          <div className="stamp-circle">
            <span className="stamp-char">確</span>
            <span className="stamp-label">제출 완료</span>
          </div>
        </div>
        <h2 className="done-title">학습 체험 완료</h2>
        <p className="done-sub">{name}님, 신고서 작성과 설문에 참여해주셔서 감사합니다</p>
        <div className="done-summary">
          <div className="summary-row">
            <span className="summary-label">참여자</span>
            <span className="summary-value">
              {name} ({empId})
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-label">소속</span>
            <span className="summary-value">{deptName}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">신고서</span>
            <span className="summary-value">{formName}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">시나리오</span>
            <span className="summary-value">{scenarioTitle}</span>
          </div>
        </div>
        <div className="learning-note">
          <div className="learning-title">💡 오늘의 학습 포인트</div>
          <ul className="learning-list">
            <li>특정 부패위험 상황 → 어떤 신고서를 작성해야 하는지 확인했습니다</li>
            <li>실제 신고가 필요한 경우 동일한 양식·항목으로 작성·제출하면 됩니다</li>
            <li>신고서는 청탁방지담당관 또는 이해충돌방지담당관에게 제출합니다</li>
            <li>신고는 의무이며, 신고자는 법령에 따라 보호받습니다</li>
          </ul>
        </div>
        <button className="btn-primary btn-large" onClick={onReset}>
          다른 시나리오 체험하기
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 하단 푸터
// ────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="footer">
      <div>© KEITI 한국환경산업기술원 · 청렴 학습 체험</div>
      <div className="footer-sub">
        본 페이지는 학습용 시뮬레이션입니다. 실제 신고는 본원 청탁방지담당관에게 정식 제출하시기
        바랍니다.
      </div>
    </footer>
  );
}
