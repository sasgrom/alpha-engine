/**
 * One-shot cleanup (4e, owner directive: "no old DB copies — delete the
 * artifacts"): after the 4d migration cloned all data into the new site DB
 * (1a141806-…, verified on prod), drop every table of the OLD site DB
 * (1a11d1cf-…) so no stale copy lingers. .env now points at the new DB.
 * Run: npx tsx t_4e_drop_old_db.mts
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const url = new URL(process.env.DATABASE_URL!);
if (!url.pathname.includes("1a141806")) throw new Error("env not switched to the new DB");
const OLD = "1a11d1cf-ade2-82ed-8000-0966c8a920c7";

const conn = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
});

// sanity: the NEW db must be populated before dropping anything old
const [u]: any = await conn.query(`SELECT COUNT(*) n FROM \`${"1a141806-8802-84e1-8000-0966f924ee29"}\`.users`);
if (Number(u[0].n) < 2) throw new Error("new DB looks empty — refusing to drop the old one");
console.log("new db users:", u[0].n);

const [tables]: any = await conn.query(`SHOW TABLES IN \`${OLD}\``);
const names = tables.map((t: any) => String(Object.values(t)[0]));
for (const t of names) {
  await conn.query(`DROP TABLE \`${OLD}\`.\`${t}\``);
}
console.log(`old DB artifacts dropped: ${names.length} tables`);
await conn.end();
process.exit(0);
