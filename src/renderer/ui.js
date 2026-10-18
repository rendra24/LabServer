// Util bersama renderer. Semua teks dari main/server dirender lewat textContent, tidak pernah innerHTML.
export const $ = (id) => document.getElementById(id);

export function el(tag, { text, cls, attrs } = {}, ...children) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  n.append(...children);
  return n;
}

export const announce = (m) => ($("status").textContent = m);

export function showError(m) {
  $("error").textContent = m || "";
  $("error").hidden = !m;
}

export async function busy(button, label, fn) {
  const original = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(el("span", { cls: "spinner", attrs: { "aria-hidden": "true" } }), label);
  try {
    return await fn();
  } finally {
    button.replaceChildren(...original);
    button.disabled = false;
  }
}

export const FILENAME_RE = /^[A-Za-z0-9._-]+$/;
export const validFilename = (n) => n.length >= 1 && n.length <= 255 && FILENAME_RE.test(n) && !/^[.-]/.test(n);
export const DOMAIN_RE = /^[A-Za-z0-9.-]+$/;

const secretQueue = [];
let activeSecret = null;

function showNextSecret() {
  if (activeSecret || !secretQueue.length) return;
  const job = secretQueue.shift();
  activeSecret = job;
  const { title, label, description, allowRemember, submitLabel = "Hubungkan" } = job.options;
  const d = $("secret-dialog"), form = $("secret-form");
  $("secret-title").textContent = title;
  $("secret-label").textContent = label;
  $("secret-desc").textContent = description || "";
  $("secret-input").value = "";
  $("remember").checked = false;
  $("remember-row").hidden = !allowRemember;
  $("secret-submit").textContent = submitLabel;
  let settled = false, answer = null;
  const finish = () => {
    form.removeEventListener("submit", onSubmit);
    d.removeEventListener("close", onClose);
    job.options.signal?.removeEventListener("abort", job.abort);
    activeSecret = null;
    job.resolve(answer);
    showNextSecret();
  };
  job.done = value => {
    if (settled) return;
    settled = true;
    answer = value;
    $("secret-input").value = "";
    // Wait for this dialog's close event before attaching the next request's listeners.
    if (d.open) d.close();
    else finish();
  };
  const onSubmit = e => {
    e.preventDefault();
    job.done({ value: $("secret-input").value, remember: $("remember").checked });
  };
  const onClose = () => settled ? finish() : job.done(null);
  form.addEventListener("submit", onSubmit);
  d.addEventListener("close", onClose);
  d.showModal();
  $("secret-input").focus();
}

/** Dialog password/passphrase/sudo, serialized across callers. Resolves null on cancellation. */
export function askSecret(options) {
  if (options.signal?.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const job = { options, resolve };
    job.abort = () => {
      if (activeSecret === job) job.done(null);
      else {
        const index = secretQueue.indexOf(job);
        if (index !== -1) secretQueue.splice(index, 1);
        options.signal?.removeEventListener("abort", job.abort);
        resolve(null);
      }
    };
    options.signal?.addEventListener("abort", job.abort, { once: true });
    secretQueue.push(job);
    showNextSecret();
  });
}

export function appendLog(pre, text, cls = "text-slate-100") {
  pre.querySelector("[data-placeholder]")?.remove();
  pre.append(el("span", { text: `${text}\n`, cls }));
  pre.scrollTop = pre.scrollHeight;
}
