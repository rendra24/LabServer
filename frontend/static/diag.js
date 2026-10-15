import { ApiError, api, el } from "/static/common.js";

export function appendLog(pre, text, cls = "text-slate-100") {
  pre.querySelector("[data-placeholder]")?.remove();
  pre.append(el("span", { text: `${text}\n`, cls }));
  pre.scrollTop = pre.scrollHeight;
}

export function logHeader(pre, text) {
  appendLog(pre, `$ ${text}`, "text-sky-300");
}

export async function busy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.replaceChildren(el("span", { cls: "spinner", attrs: { "aria-hidden": "true" } }), label);
  try {
    return await fn();
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

/** Menjalankan nginx -t. Mengembalikan true jika sintaks valid. */
export async function runSyntaxTest(pre, siteId) {
  logHeader(pre, "sudo nginx -t");
  try {
    const r = await api("/api/v1/nginx/test", {
      method: "POST",
      body: siteId ? { site_id: siteId } : {},
    });
    if (r.stdout) appendLog(pre, r.stdout.trimEnd());
    // nginx menulis hasil ke stderr; merah/oranye hanya jika gagal
    if (r.stderr) appendLog(pre, r.stderr.trimEnd(), r.is_success ? "text-emerald-300" : "text-orange-300");
    appendLog(pre, r.is_success ? "✔ Sintaks valid" : "✘ Sintaks tidak valid", r.is_success ? "text-emerald-300" : "text-red-300");
    return r.is_success;
  } catch (e) {
    appendLog(pre, `✘ ${e.message}`, "text-red-300");
    return false;
  }
}

/** Reload Nginx. Mengembalikan true jika berhasil. */
export async function runReload(pre) {
  logHeader(pre, "sudo systemctl reload nginx");
  try {
    const r = await api("/api/v1/nginx/reload", { method: "POST" });
    appendLog(pre, `✔ ${r.message}`, "text-emerald-300");
    return true;
  } catch (e) {
    appendLog(pre, `✘ ${e.message}`, "text-red-300");
    if (e instanceof ApiError && e.details) appendLog(pre, e.details, "text-orange-300");
    return false;
  }
}
