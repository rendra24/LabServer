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

export const FILENAME_RE = /^[A-Za-z0-9._-]+$/;
export const validFilename = (n) => n.length >= 1 && n.length <= 255 && FILENAME_RE.test(n) && !/^[.-]/.test(n);
export const DOMAIN_RE = /^[A-Za-z0-9.-]+$/;

/** Dialog password/passphrase/sudo. Resolve {value, remember} atau null bila dibatalkan. */
export function askSecret({ title, label, description, allowRemember, submitLabel = "Hubungkan" }) {
  const d = $("secret-dialog");
  $("secret-title").textContent = title;
  $("secret-label").textContent = label;
  $("secret-desc").textContent = description || "";
  $("secret-input").value = "";
  $("remember").checked = false;
  $("remember-row").hidden = !allowRemember;
  $("secret-submit").textContent = submitLabel;
  d.showModal();
  $("secret-input").focus();
  return new Promise((resolve) => {
    const form = $("secret-form");
    const done = (value) => {
      form.removeEventListener("submit", onSubmit);
      d.removeEventListener("close", onClose);
      if (d.open) d.close();
      resolve(value);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      done({ value: $("secret-input").value, remember: $("remember").checked });
    };
    const onClose = () => done(null);
    form.addEventListener("submit", onSubmit);
    d.addEventListener("close", onClose);
  });
}

export function appendLog(pre, text, cls = "text-slate-100") {
  pre.querySelector("[data-placeholder]")?.remove();
  pre.append(el("span", { text: `${text}\n`, cls }));
  pre.scrollTop = pre.scrollHeight;
}
