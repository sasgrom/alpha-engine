/**
 * One-shot DB migration (4d hotfix): the platform provisioned a FRESH empty
 * database for the alphadelta-2 deployment (1a141806-…) while all data lives
 * in the original site DB (1a11d1cf-…). Both are visible from this sandbox
 * with the same cluster credentials. Clone structure + data old → new.
 * Idempotent (CREATE TABLE IF NOT EXISTS LIKE + INSERT IGNORE by PK).
 * Big tables are chunked by id range to stay under TiDB txn limits.
 * Run: npx tsx t_4d_migrate_db.mts
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const url = new URL(process.env.DATABASE_URL!);
const OLD = url.pathname.slice(1); // 1a11d1cf-… (data)
const NEW = "1a141806-8802-84e1-8000-0966f924ee29"; // the empty prod DB

const conn = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: OLD,
  multipleStatements: false,
});

const fail = (m: string): never => {
  console.error("FAIL:", m);
  process.exit(1);
};

const [tablesRaw]: any = await conn.query("SHOW TABLES");
const tables = tablesRaw.map((t: any) => String(Object.values(t)[0])).filter((t: string) => t !== "__drizzle_migrations");
console.log(`tables: ${tables.length}`);

for (const t of tables) {
  await conn.query(`CREATE TABLE IF NOT EXISTS \`${NEW}\`.\`${t}\` LIKE \`${OLD}\`.\`${t}\``);
  const [c]: any = await conn.query(`SELECT COUNT(*) n FROM \`${OLD}\`.\`${t}\``);
  const total = Number(c[0].n);
  if (total === 0) {
    console.log(`${t}: 0 rows (structure only)`);
    continue;
  }
  // serial-id tables get chunked id-range copies; the rest go in one shot
  const [idCol]: any = await conn.query(
    `SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name='id'`,
    [OLD, t]
  );
  const hasId = Number(idCol[0].n) === 1;
  if (hasId && total > 20000) {
    const [mm]: any = await conn.query(`SELECT MIN(id) lo, MAX(id) hi FROM \`${OLD}\`.\`${t}\``);
    const lo = Number(mm[0].lo), hi = Number(mm[0].hi);
    const CHUNK = 30000;
    let copied = 0;
    for (let a = lo; a <= hi; a += CHUNK) {
      const b = a + CHUNK - 1;
      const [r]: any = await conn.query(
        `INSERT IGNORE INTO \`${NEW}\`.\`${t}\` SELECT * FROM \`${OLD}\`.\`${t}\` WHERE id BETWEEN ? AND ?`,
        [a, b]
      );
      copied += Number(r.affectedRows ?? 0);
    }
    console.log(`${t}: ${copied}/${total} rows (chunked)`);
  } else {
    const [r]: any = await conn.query(`INSERT IGNORE INTO \`${NEW}\`.\`${t}\` SELECT * FROM \`${OLD}\`.\`${t}\``);
    console.log(`${t}: ${r.affectedRows}/${total} rows`);
  }
  // auto-increment high-water mark must survive the copy (explicit ids do
  // advance it on InnoDB/TiDB, but set it explicitly — jobs ids are huge)
  if (hasId) {
    const [mx]: any = await conn.query(`SELECT MAX(id) m FROM \`${NEW}\`.\`${t}\``);
    if (mx[0].m !== null) {
      await conn.query(`ALTER TABLE \`${NEW}\`.\`${t}\` AUTO_INCREMENT = ${Number(mx[0].m) + 1}`);
    }
  }
}

// verify counts match
let ok = true;
for (const t of tables) {
  const [a]: any = await conn.query(`SELECT COUNT(*) n FROM \`${OLD}\`.\`${t}\``);
  const [b]: any = await conn.query(`SELECT COUNT(*) n FROM \`${NEW}\`.\`${t}\``);
  if (Number(a[0].n) !== Number(b[0].n)) {
    console.error(`MISMATCH ${t}: old=${a[0].n} new=${b[0].n}`);
    ok = false;
  }
}
if (!ok) fail("count mismatches — see above");

// spot-check the login-critical rows
const [u]: any = await conn.query(`SELECT id, username, role, passwordHash IS NOT NULL hpw FROM \`${NEW}\`.users ORDER BY id`);
console.log("new db users:", JSON.stringify(u));

await conn.end();
console.log("PASS: database cloned to the alphadelta-2 site DB");
process.exit(0);
