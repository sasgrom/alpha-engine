/** Owner-run reviewer seed. Reads credentials from env and never prints them. */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { createLocalUser, findUserByUsername } from "../api/queries/users";
import { hashPassword } from "../api/services/passwords";
import { reviewerAccess, reviewerTourPreferences, userUniverse } from "@db/schema";
import { NDA_VERSION, REVIEWER_TOURS, type ReviewerTourTrack } from "@contracts/reviewer";
import { loadEdgarUniverse } from "../worker/lib/edgar";

const username = process.env.REVIEWER_USERNAME?.trim();
const password = process.env.REVIEWER_PASSWORD;
const displayName = process.env.REVIEWER_DISPLAY_NAME?.trim() || "Dr. Larry Souza";
if (!username || !password) throw new Error("Set REVIEWER_USERNAME and REVIEWER_PASSWORD in the local environment only");
if (await findUserByUsername(username)) throw new Error("Reviewer account already exists; use the owner password-reset flow instead of reseeding");

const user = await createLocalUser({ username, passwordHash: await hashPassword(password), name: displayName, role: "user" });
if (!user) throw new Error("Reviewer account creation failed");
const db = getDb();
await db.insert(reviewerAccess).values({ userId: user.id, ndaVersion: NDA_VERSION });
await db.insert(reviewerTourPreferences).values((Object.keys(REVIEWER_TOURS) as ReviewerTourTrack[]).map((track) => ({ userId: user.id, track, ...{ currentStep: 0, status: "not_started" } })));
const universe = loadEdgarUniverse("research-universe-50.json");
if (universe.length !== 50 || new Set(universe.map((row) => row.cik)).size !== 50) throw new Error("Expected exactly 50 unique presentation CIKs");
await db.insert(userUniverse).values(universe.map((row) => ({ userId: user.id, cik: row.cik, ticker: row.ticker, name: row.name, active: true })));
console.log(JSON.stringify({ reviewerId: user.id, presentationCompanies: universe.length, ndaRequired: true, firstIpBound: false }));
process.exit(0);
