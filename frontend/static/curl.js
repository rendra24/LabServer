import { DOMAIN_RE, api, announce, clearError, el, showError } from "/static/common.js";
import { busy } from "/static/diag.js";

const $ = (id) => document.getElementById(id);
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
let profiles = [];

function fieldError(field, message) {
  $(`${field}-err`).textContent = message;
  if (message) $(field)?.setAttribute("aria-invalid", "true");
  else $(field)?.removeAttribute("aria-invalid");
  return Boolean(message);
}

const defaultPort = (protocol) => (protocol === "HTTPS" ? "443" : "80");

function parseUrl(value) {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const u = new URL(value);
    return u.hostname && DOMAIN_RE.test(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

function buildUrl(domain, protocol, port) {
  const scheme = protocol.toLowerCase();
  return `${scheme}://${domain}${port && port !== defaultPort(protocol) ? `:${port}` : ""}`;
}

// --- sinkronisasi URL / protokol / port --------------------------------------------------
$("url").addEventListener("input", () => {
  const u = parseUrl($("url").value.trim());
  if (!u) return;
  const protocol = u.protocol === "https:" ? "HTTPS" : "HTTP";
  $("protocol").value = protocol;
  $("port").value = u.port || defaultPort(protocol);
  if (!$("headers").dataset.touched) $("headers").value = JSON.stringify({ Host: u.hostname });
});
$("headers").addEventListener("input", () => ($("headers").dataset.touched = "1"));
$("protocol").addEventListener("change", () => {
  const old = $("protocol").value === "HTTPS" ? "80" : "443";
  if ($("port").value === old) $("port").value = defaultPort($("protocol").value);
  const u = parseUrl($("url").value.trim());
  if (u) $("url").value = buildUrl(u.hostname, $("protocol").value, $("port").value);
});

// --- validasi form ---------------------------------------------------------------------
function readForm() {
  let bad = false;
  const u = parseUrl($("url").value.trim());
  bad = fieldError("url", u ? "" : "URL wajib diawali http:// atau https:// dan berisi domain yang valid.") || bad;

  const ip = $("ip").value.trim();
  const ipOk = !ip || IPV4_RE.test(ip) || (ip.includes(":") && IPV6_RE.test(ip));
  bad = fieldError("ip", ipOk ? "" : "IP resolusi harus berupa alamat IPv4 atau IPv6 yang valid.") || bad;

  const port = Number($("port").value);
  bad = fieldError("port", Number.isInteger(port) && port >= 1 && port <= 65535 ? "" : "Port harus bilangan bulat 1–65535.") || bad;

  let headers = null;
  const rawHeaders = $("headers").value.trim();
  if (rawHeaders) {
    try {
      headers = JSON.parse(rawHeaders);
      if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((v) => typeof v !== "string")) {
        throw new Error();
      }
    } catch {
      headers = null;
      bad = fieldError("headers", "Format header harus berupa JSON objek yang valid.") || true;
    }
  }
  if (rawHeaders && headers) fieldError("headers", "");
  if (!rawHeaders) fieldError("headers", "");

  if (bad) {
    (document.querySelector("[aria-invalid]") || $("url")).focus();
    return null;
  }
  return {
    target_domain: u.hostname,
    resolve_ip: ip || null,
    port,
    protocol: $("protocol").value,
    custom_headers: headers,
  };
}

// --- hasil -----------------------------------------------------------------------------
function statusBadge(code, ok) {
  const [text, cls] =
    code === 0 || !ok
      ? ["000", "bg-slate-600 text-white"]
      : code < 300
        ? [String(code), "bg-emerald-800 text-emerald-50"]
        : code < 400
          ? [String(code), "bg-sky-800 text-sky-50"]
          : code < 500
            ? [String(code), "bg-yellow-700 text-yellow-50"]
            : [String(code), "bg-red-800 text-red-50"];
  return el("span", { text, cls: `badge text-lg ${cls}` });
}

function render(r) {
  $("placeholder").hidden = true;
  $("result").hidden = false;
  $("m-status").replaceChildren(statusBadge(r.status_code, r.is_success));
  $("m-ttfb").textContent = r.is_success ? `${r.ttfb_ms} ms` : "—";
  $("m-ssl").textContent = r.ssl_status;
  const err = $("m-error");
  err.hidden = r.is_success;
  err.textContent = r.is_success ? "" : `000 ${r.error}`;
  $("panel-headers").textContent = r.raw_output || "(tidak ada header respons)";
  $("panel-command").textContent = r.command;
}

function selectTab(name) {
  for (const t of ["headers", "command"]) {
    const on = t === name;
    $(`tab-${t}`).setAttribute("aria-selected", String(on));
    $(`tab-${t}`).tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
}
$("tab-headers").addEventListener("click", () => selectTab("headers"));
$("tab-command").addEventListener("click", () => selectTab("command"));
document.querySelector('[role="tablist"]').addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const next = $("tab-headers").getAttribute("aria-selected") === "true" ? "command" : "headers";
    selectTab(next);
    $(`tab-${next}`).focus();
  }
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const body = readForm();
  if (!body) return;
  await busy($("run"), "Menjalankan…", async () => {
    try {
      const r = await api("/api/v1/curl/test", { method: "POST", body });
      render(r);
      announce(r.is_success ? `Selesai: HTTP ${r.status_code}, ${r.ttfb_ms} ms.` : `Gagal: ${r.error}`);
    } catch (err) {
      showError(err.message);
    }
  });
});

// --- profil ----------------------------------------------------------------------------
async function loadProfiles() {
  try {
    profiles = await api("/api/v1/profiles");
    $("profile").replaceChildren(
      el("option", { text: "— pilih profil —", attrs: { value: "" } }),
      ...profiles.map((p) => el("option", { text: `${p.target_domain} → ${p.resolve_ip}:${p.port}`, attrs: { value: String(p.id) } })),
    );
  } catch (e) {
    showError(e.message);
  }
}

$("profile").addEventListener("change", () => {
  const p = profiles.find((x) => String(x.id) === $("profile").value);
  if (!p) return;
  const protocol = p.port === 443 || p.port === 8443 ? "HTTPS" : "HTTP";
  $("protocol").value = protocol;
  $("port").value = String(p.port);
  $("url").value = buildUrl(p.target_domain, protocol, String(p.port));
  $("ip").value = p.resolve_ip;
  $("headers").value = p.custom_headers ? JSON.stringify(p.custom_headers) : "";
  $("headers").dataset.touched = "1";
  $("site").value = String(p.site_id);
  for (const f of ["url", "ip", "port", "headers"]) fieldError(f, "");
});

$("save-profile").addEventListener("click", async () => {
  clearError();
  const body = readForm();
  if (!body) return;
  const siteMissing = fieldError("site", $("site").value ? "" : "Pilih situs untuk menyimpan profil.");
  if (siteMissing) return $("site").focus();
  if (!body.resolve_ip) {
    fieldError("ip", "Profil memerlukan IP resolusi.");
    return $("ip").focus();
  }
  try {
    await api("/api/v1/profiles", {
      method: "POST",
      body: {
        site_id: Number($("site").value),
        target_domain: body.target_domain,
        resolve_ip: body.resolve_ip,
        port: body.port,
        custom_headers: body.custom_headers,
      },
    });
    announce("Profil disimpan.");
    await loadProfiles();
  } catch (e) {
    showError(e.message);
  }
});

async function loadSites() {
  try {
    const { items } = await api("/api/v1/sites?limit=200");
    $("site").replaceChildren(
      el("option", { text: "— pilih situs —", attrs: { value: "" } }),
      ...items.map((s) => el("option", { text: s.filename, attrs: { value: String(s.id) } })),
    );
  } catch (e) {
    showError(e.message);
  }
}

loadProfiles();
loadSites();
