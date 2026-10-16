import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceDomain } from "../static/clone.js";

const run = (text, from, to) => replaceDomain(text, from, to);

test("mengganti server_name, root, dan nama log", () => {
  const src = `server {
    server_name app.local www.app.local;
    root /var/www/app.local/public;
    access_log /var/log/nginx/app.local.access.log;
}`;
  const r = run(src, "app.local", "baru.test");
  assert.equal(r.count, 4);
  assert.ok(r.text.includes("server_name baru.test www.baru.test;"));
  assert.ok(r.text.includes("/var/www/baru.test/public"));
  assert.ok(r.text.includes("baru.test.access.log"));
  assert.ok(!r.text.includes("app.local"));
});

test("tidak menyentuh domain lain yang hanya mengandung teks yang sama", () => {
  const r = run("server_name myapp.local app.local-staging.com app.local;", "app.local", "x.test");
  assert.equal(r.text, "server_name myapp.local app.local-staging.com x.test;");
  assert.equal(r.count, 1);
});

test("karakter regex di domain diperlakukan literal", () => {
  const r = run("server_name a.b; server_name aXb;", "a.b", "c.d");
  assert.equal(r.text, "server_name c.d; server_name aXb;");
});

test("tanpa kecocokan atau input kosong: tidak berubah", () => {
  assert.deepEqual(run("server {}", "app.local", "x.test"), { text: "server {}", count: 0 });
  assert.deepEqual(run("server_name a;", "", "x"), { text: "server_name a;", count: 0 });
  assert.deepEqual(run("server_name a;", "a", ""), { text: "server_name a;", count: 0 });
});

test("pengganti berisi $ tidak ditafsirkan sebagai pola", () => {
  const r = run("server_name a.test;", "a.test", "$&.x");
  assert.equal(r.text, "server_name $&.x;");
});

test("tidak case-sensitive", () => {
  assert.equal(run("server_name APP.local;", "app.local", "x.test").text, "server_name x.test;");
});
