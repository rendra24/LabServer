const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "src", "renderer", "format.js")).href);

test("formatValue per satuan", async () => {
  const { formatValue } = await load();
  assert.equal(formatValue("percent", 12.345), "12,3%");
  assert.equal(formatValue("bytesPerSec", 1536), "1,5 KB/dtk");
  assert.equal(formatValue("bytesPerSec", 5 * 1024 * 1024 * 1024), "5 GB/dtk");
  assert.equal(formatValue("bytesPerSec", 0), "0 B/dtk");
  assert.equal(formatValue("perSec", 3.14159), "3,14/dtk");
  assert.equal(formatValue("count", 1234.6), "1.235");
  assert.equal(formatValue("ratio", 1), "Aktif");
  assert.equal(formatValue("ratio", 0), "Mati");
  assert.equal(formatValue("number", 0.456), "0,46");
});

test("uptime dalam hari/jam/menit", async () => {
  const { formatValue } = await load();
  assert.equal(formatValue("seconds", 3 * 86400 + 4 * 3600 + 5 * 60 + 9), "3h 4j 5m");
  assert.equal(formatValue("seconds", 2 * 3600 + 30 * 60), "2j 30m");
  assert.equal(formatValue("seconds", 75), "1m 15d");
});

test("nilai kosong tampil '—'", async () => {
  const { formatValue } = await load();
  for (const v of [null, undefined, NaN]) assert.equal(formatValue("percent", v), "—");
});

test("summarize abaikan null", async () => {
  const { summarize } = await load();
  assert.deepEqual(summarize([[1, 2], [2, null], [3, 6]]), { min: 2, max: 6, avg: 4 });
  assert.equal(summarize([[1, null]]), null);
  assert.equal(summarize([]), null);
});
