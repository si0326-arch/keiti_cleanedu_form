// 마이그레이션 실행기
//  접속 정보 우선순위: 1) 환경변수 DATABASE_URL  2) 로컬 비밀 파일 .env.migration 의 MIGRATION_DATABASE_URL
//  ⚠️ 접속 문자열(비밀번호 포함)은 코드에 하드코딩하지 않는다. .env.migration 은 .gitignore 처리됨.
//  사용법: node scripts/run-migration.mjs <sql파일경로>
import { readFileSync } from 'node:fs';
import pg from 'pg';

function loadConnString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const txt = readFileSync(new URL('../.env.migration', import.meta.url), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*MIGRATION_DATABASE_URL\s*=\s*(.+?)\s*$/);
      if (m) return m[1];
    }
  } catch {
    /* 파일 없으면 무시 */
  }
  return null;
}

const url = loadConnString();
const sqlPath = process.argv[2];

if (!sqlPath) {
  console.error('❌ 사용법: node scripts/run-migration.mjs <sql파일>');
  process.exit(1);
}
if (!url) {
  console.error('❌ 접속 정보 없음 — .env.migration 의 MIGRATION_DATABASE_URL 을 확인하세요.');
  process.exit(1);
}

const sql = readFileSync(sqlPath, 'utf8');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log(`✅ 적용 완료: ${sqlPath}`);
} catch (e) {
  console.error(`❌ 실패: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
