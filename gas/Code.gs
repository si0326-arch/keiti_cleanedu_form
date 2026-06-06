/**
 * KEITI 신고서 체험 - Google Apps Script (v3)
 * 역할: 신고서 + 설문 데이터를 받아 Google Sheets에 기록
 *
 * 변경 이력
 *  v2 - 신고서 필드 누락분 추가: reason(이충법 위반행위 신고서), superior/instruction/defense(소명서)
 *  v3 - (이번 수정)
 *     · ensureHeaders 가 "기존 시트의 헤더도 자동 교정" → 시트가 이미 있어도 칼럼이 안 어긋남
 *     · 시트 열 수가 부족하면 자동 확장 (헤더가 56칸이라 기본 26칸에서 깨지던 문제 방지)
 *     · 향상도(diff) 값이 0(전후 변화 없음)일 때 빈칸이 아니라 0으로 저장 (cell 헬퍼)
 *     · 메인 시트에도 setFrozenRows(1) 적용 (이전엔 누락 + 깨진 ");" 줄 정리)
 *     · resetSheets() 수동 유틸 추가 (옛 테스트 데이터 정리용)
 *
 * 배포 방법
 *  1. 확장프로그램 > Apps Script 에 이 코드 전체 붙여넣기 → 저장
 *  2. 배포 > 배포 관리 > (연필)편집 > 버전: "새 버전" > 배포   ← 코드 저장만으론 반영 안 됨!
 *     - 실행: 나(본인 계정)  /  액세스: 모든 사용자(익명 포함)
 *  3. /exec URL 은 그대로 유지됨 (App 의 src/data.js > GOOGLE_SCRIPT_URL 과 동일해야 함)
 *
 * ⚠️ 이미 쌓인 옛 행에 대하여
 *  - 옛 코드가 옛 칼럼 순서로 기록한 기존 행들은 헤더를 고쳐도 그 행만은 정렬이 맞지 않습니다.
 *  - 옛 데이터가 테스트뿐이라면, 편집기에서 resetSheets() 를 한 번 실행해 데이터행을 비우세요.
 */

// ── 시트 이름 ──────────────────────────────────────────────────
const SHEET_MAIN   = '제출결과';   // 신고서 + 설문 통합
const SHEET_SURVEY = '설문분석';   // 설문만 따로 (전후비교 분석용)

// ── 헤더 정의 (순서 = 시트 열 순서, doPost 의 행 순서와 1:1 대응) ──
const HEADER_MAIN = [
  '제출일시', '사번', '이름', '소속코드', '소속명',
  '신고서ID', '신고서명', '시나리오ID', '시나리오명',
  // 신고서 작성 내용 (values) - 양식마다 해당 칸만 채워짐
  '신고서_offender', '신고서_purpose', '신고서_reason',
  '신고서_date', '신고서_place',
  '신고서_content', '신고서_return', '신고서_evidence',
  '신고서_work', '신고서_relatedPerson', '신고서_personType',
  '신고서_relationship', '신고서_duty', '신고서_dutyTypeCheck',
  '신고서_superior', '신고서_instruction', '신고서_defense',
  // A. 강사 만족도
  'A1_강사설명력', 'A2_강사반응', 'A3_강사전달력', 'A4_강사만족도',
  // B. 교육 이해도 전후
  'B1_청탁금지법_전', 'B1_청탁금지법_후', 'B1_청탁금지법_향상',
  'B2_이해충돌방지법_전', 'B2_이해충돌방지법_후', 'B2_이해충돌방지법_향상',
  'B3_행동강령_전', 'B3_행동강령_후', 'B3_행동강령_향상',
  'B4_갑질_전', 'B4_갑질_후', 'B4_갑질_향상',
  'B5_공익신고_전', 'B5_공익신고_후', 'B5_공익신고_향상',
  // C. 신고서 체험 전후
  'C1_신고제도운영_전', 'C1_신고제도운영_후', 'C1_신고제도운영_향상',
  'C2_상황별신고서_전', 'C2_상황별신고서_후', 'C2_상황별신고서_향상',
  'C3_작성자신감_전', 'C3_작성자신감_후', 'C3_작성자신감_향상',
  // D. 선택 주관식
  'D1_유용한기능', 'D2_개선의견',
];

const HEADER_SURVEY = [
  '제출일시', '사번', '이름', '소속명',
  'A1_강사설명력', 'A2_강사반응', 'A3_강사전달력', 'A4_강사만족도', 'A_평균',
  'B1_청탁_전', 'B1_청탁_후', 'B1_향상',
  'B2_이충법_전', 'B2_이충법_후', 'B2_향상',
  'B3_행동강령_전', 'B3_행동강령_후', 'B3_향상',
  'B4_갑질_전', 'B4_갑질_후', 'B4_향상',
  'B5_공익_전', 'B5_공익_후', 'B5_향상',
  'B_전_평균', 'B_후_평균', 'B_향상_평균',
  'C1_제도운영_전', 'C1_제도운영_후', 'C1_향상',
  'C2_상황별_전', 'C2_상황별_후', 'C2_향상',
  'C3_자신감_전', 'C3_자신감_후', 'C3_향상',
  'C_전_평균', 'C_후_평균', 'C_향상_평균',
  'D1_유용한기능', 'D2_개선의견',
];

// ── 유틸 ───────────────────────────────────────────────────────
// 0 과 음수는 보존하고, undefined/null/'' 만 빈칸으로 (diff=0 이 사라지던 버그 방지)
function cell(x) {
  if (x === 0) return 0;
  if (x === null || x === undefined || x === '') return '';
  return x;
}

// 빈값 제외 평균 (소수 1자리 반올림)
function avg(values) {
  const nums = values.filter(v => v !== '' && v !== null && v !== undefined && !isNaN(v));
  if (!nums.length) return '';
  return Math.round((nums.reduce((a, b) => a + Number(b), 0) / nums.length) * 10) / 10;
}

// ── 시트 + 헤더 보장 (없으면 생성, 있으면 헤더 자동 교정) ────────
function ensureHeaders(ss) {
  const mainSheet   = ensureSheet_(ss, SHEET_MAIN,   HEADER_MAIN,   '#1e3a5f');
  const surveySheet = ensureSheet_(ss, SHEET_SURVEY, HEADER_SURVEY, '#2d6a4f');
  return { mainSheet, surveySheet };
}

function ensureSheet_(ss, name, header, color) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const width = header.length;

  // 헤더가 기본 열 수(26)보다 넓으면 먼저 열을 확장한다.
  const maxCols = sheet.getMaxColumns();
  if (maxCols < width) sheet.insertColumnsAfter(maxCols, width - maxCols);

  // 1행이 기대 헤더와 다르면(누락·오타·옛 순서 포함) 새로 써서 항상 정렬을 맞춘다.
  const current = sheet.getRange(1, 1, 1, width).getValues()[0];
  const matches = header.every((h, i) => current[i] === h);
  if (!matches) {
    const hr = sheet.getRange(1, 1, 1, width);
    hr.setValues([header]);
    hr.setBackground(color).setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── POST: 앱에서 fetch 로 호출 ─────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const { mainSheet, surveySheet } = ensureHeaders(ss);

    const s   = data.survey || {};
    const v   = data.values || {};
    const now = data.submittedAt || new Date().toISOString();

    // ── 메인 시트 행 (HEADER_MAIN 과 동일 순서) ──
    const mainRow = [
      now,
      cell(data.empId), cell(data.name), cell(data.deptId), cell(data.deptName),
      cell(data.formId), cell(data.formName), cell(data.scenarioId), cell(data.scenarioTitle),
      cell(v.offender), cell(v.purpose), cell(v.reason),
      cell(v.date), cell(v.place),
      cell(v.content), cell(v.return), cell(v.evidence),
      cell(v.work), cell(v.relatedPerson), cell(v.personType),
      cell(v.relationship), cell(v.duty), cell(v.dutyTypeCheck),
      cell(v.superior), cell(v.instruction), cell(v.defense),
      // A
      cell(s.a1_explain), cell(s.a2_response), cell(s.a3_delivery), cell(s.a4_overall),
      // B
      cell(s.b1_bribery_before), cell(s.b1_bribery_after), cell(s.b1_bribery_diff),
      cell(s.b2_conflict_before), cell(s.b2_conflict_after), cell(s.b2_conflict_diff),
      cell(s.b3_conduct_before), cell(s.b3_conduct_after), cell(s.b3_conduct_diff),
      cell(s.b4_harassment_before), cell(s.b4_harassment_after), cell(s.b4_harassment_diff),
      cell(s.b5_whistleblow_before), cell(s.b5_whistleblow_after), cell(s.b5_whistleblow_diff),
      // C
      cell(s.c1_system_before), cell(s.c1_system_after), cell(s.c1_system_diff),
      cell(s.c2_which_before), cell(s.c2_which_after), cell(s.c2_which_diff),
      cell(s.c3_confidence_before), cell(s.c3_confidence_after), cell(s.c3_confidence_diff),
      // D
      cell(s.d1_useful), cell(s.d2_improve),
    ];
    mainSheet.appendRow(mainRow);

    // ── 설문 분석 시트 행 (HEADER_SURVEY 와 동일 순서) ──
    const bBefore = [s.b1_bribery_before, s.b2_conflict_before, s.b3_conduct_before, s.b4_harassment_before, s.b5_whistleblow_before];
    const bAfter  = [s.b1_bribery_after,  s.b2_conflict_after,  s.b3_conduct_after,  s.b4_harassment_after,  s.b5_whistleblow_after];
    const cBefore = [s.c1_system_before, s.c2_which_before, s.c3_confidence_before];
    const cAfter  = [s.c1_system_after,  s.c2_which_after,  s.c3_confidence_after];
    const diffs = (after, before) => after.map((a, i) =>
      (a !== '' && a != null && before[i] !== '' && before[i] != null) ? Number(a) - Number(before[i]) : '');

    const surveyRow = [
      now, cell(data.empId), cell(data.name), cell(data.deptName),
      cell(s.a1_explain), cell(s.a2_response), cell(s.a3_delivery), cell(s.a4_overall),
      avg([s.a1_explain, s.a2_response, s.a3_delivery, s.a4_overall]),
      cell(s.b1_bribery_before), cell(s.b1_bribery_after), cell(s.b1_bribery_diff),
      cell(s.b2_conflict_before), cell(s.b2_conflict_after), cell(s.b2_conflict_diff),
      cell(s.b3_conduct_before), cell(s.b3_conduct_after), cell(s.b3_conduct_diff),
      cell(s.b4_harassment_before), cell(s.b4_harassment_after), cell(s.b4_harassment_diff),
      cell(s.b5_whistleblow_before), cell(s.b5_whistleblow_after), cell(s.b5_whistleblow_diff),
      avg(bBefore), avg(bAfter), avg(diffs(bAfter, bBefore)),
      cell(s.c1_system_before), cell(s.c1_system_after), cell(s.c1_system_diff),
      cell(s.c2_which_before), cell(s.c2_which_after), cell(s.c2_which_diff),
      cell(s.c3_confidence_before), cell(s.c3_confidence_after), cell(s.c3_confidence_diff),
      avg(cBefore), avg(cAfter), avg(diffs(cAfter, cBefore)),
      cell(s.d1_useful), cell(s.d2_improve),
    ];
    surveySheet.appendRow(surveyRow);

    return json_({ result: 'ok' });
  } catch (err) {
    return json_({ result: 'error', message: err.toString() });
  }
}

// ── GET: 연결 테스트 ───────────────────────────────────────────
function doGet() {
  return json_({ result: 'ok', message: 'KEITI GAS 연결 정상' });
}

// ── 옛 데이터 정리용 수동 유틸 (Apps Script 편집기에서 직접 실행) ──
// ⚠️ 데이터행(2행~)을 모두 지웁니다. 헤더는 올바르게 다시 맞춥니다.
function resetSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureHeaders(ss);
  [SHEET_MAIN, SHEET_SURVEY].forEach(name => {
    const sh = ss.getSheetByName(name);
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, sh.getMaxColumns()).clearContent();
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
