// 마이그레이션 실행기
//  접속 정보: 로컬 비밀 파일 .env.migration 에서 읽음 (gitignore됨, 코드/깃에 비밀 없음).
//   - 권장: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE  (비번을 따로 둬서 특수문자 인코딩 불필요)
//   - 대체: MIGRATION_DATABASE_URL=postgresql://...  /  환경변수 DATABASE_URL
//  사용법: node scripts/run-migration.mjs <sql파일경로>
import { readFileSync } from 'node:fs';
import pg from 'pg';

function loadEnvFile() {
  const out = {};
  try {
    const txt = readFileSync(new URL('../.env.migration', import.meta.url), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.includes('=')) continue;
      const i = line.indexOf('=');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    /* 파일 없으면 무시 */
  }
  return out;
}

const env = loadEnvFile();
const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error('❌ 사용법: node scripts/run-migration.mjs <sql파일>');
  process.exit(1);
}

let config;
if (env.PGHOST && env.PGPASSWORD) {
  // 권장 방식: 비밀번호를 URL 인코딩 없이 그대로 전달
  config = {
    host: env.PGHOST,
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: env.PGDATABASE || 'postgres',
  };
} else if (process.env.DATABASE_URL || env.MIGRATION_DATABASE_URL) {
  config = { connectionString: process.env.DATABASE_URL || env.MIGRATION_DATABASE_URL };
} else {
  console.error('❌ 접속 정보 없음 — .env.migration 의 PGPASSWORD 등을 확인하세요.');
  process.exit(1);
}
config.ssl = { rejectUnauthorized: false };

const sql = readFileSync(sqlPath, 'utf8');
const client = new pg.Client(config);

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
