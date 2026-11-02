// Migration tests: every migration applies in order on an empty database, and data migrations do exactly what they
// claim on pre-existing rows. Uses Node's built-in SQLite (no dependencies); D1 is SQLite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DIR = new URL("../migrations/", import.meta.url);
const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const apply = (db, f) => db.exec(readFileSync(new URL(f, DIR), "utf8"));
const upTo = (db, last) => { for (const f of files) { if (f > last) break; apply(db, f); } };

test("all migrations apply cleanly, in order, on an empty database", () => {
  const db = new DatabaseSync(":memory:");
  for (const f of files) apply(db, f);
  assert.ok(files.length >= 5);
  const cols = db.prepare("PRAGMA table_info(orgs)").all().map((c) => c.name);
  for (const c of ["status", "org_type", "applied_at", "reviewed_at", "applied_by"]) assert.ok(cols.includes(c), c);
});

test("0005 backfills applied_by only where the applicant is unambiguous, never guessing", () => {
  const db = new DatabaseSync(":memory:");
  upTo(db, "0004_program_signup_and_closures.sql");
  db.exec(`INSERT INTO orgs (id, slug, name, status, applied_at) VALUES
      (1,'one-admin','One Admin','pending',1), (2,'two-admins','Two Admins','pending',1), (3,'live-one','Live','live',1);
    INSERT INTO coordinators (email, org_id, role) VALUES
      ('lead@a.test',1,'admin'), ('helper@a.test',1,'coordinator'),
      ('zed-lead@b.test',2,'admin'), ('aaa-victim@b.test',2,'admin'),
      ('live@c.test',3,'admin');`);
  apply(db, "0005_signup_hardening.sql");
  const by = Object.fromEntries(db.prepare("SELECT slug, applied_by FROM orgs").all().map((r) => [r.slug, r.applied_by]));
  assert.equal(by["one-admin"], "lead@a.test", "single admin: that person");
  assert.equal(by["two-admins"], null, "two admins: not recorded (min(email) would have picked the added person)");
  assert.equal(by["live-one"], null, "only pending programs are backfilled");
});

test("0005 enforces one pending program per applicant, and only while pending", () => {
  const db = new DatabaseSync(":memory:");
  for (const f of files) apply(db, f);
  db.exec("INSERT INTO orgs (slug, name, status, applied_by) VALUES ('p-one','P One','pending','x@a.test')");
  assert.throws(() => db.exec("INSERT INTO orgs (slug, name, status, applied_by) VALUES ('p-two','P Two','pending','x@a.test')"), /UNIQUE.*applied_by/);
  db.exec("UPDATE orgs SET status='declined' WHERE slug='p-one'");
  db.exec("INSERT INTO orgs (slug, name, status, applied_by) VALUES ('p-two','P Two','pending','x@a.test')");
  assert.throws(() => db.exec("INSERT INTO orgs (slug, name, status, applied_by) VALUES ('p-3','P 3','pending','Upper@a.test')"), /CHECK/, "stored lowercase");
});
