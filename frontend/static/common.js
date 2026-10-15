// Util bersama. Semua teks dari server dirender lewat textContent (tidak pernah innerHTML).

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Tidak dapat terhubung ke server.", 0, "NETWORK");
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* body bukan JSON */
  }
  if (!res.ok) {
    const e = data && data.error;
    throw new ApiError(e?.message || "Terjadi kesalahan pada server.", res.status, e?.code, e?.details);
  }
  return data;
}

export function el(tag, { text, cls, attrs } = {}, ...children) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

export function showError(message) {
  const banner = document.getElementById("error");
  banner.textContent = message;
  banner.hidden = false;
}

export function clearError() {
  document.getElementById("error").hidden = true;
}

export function announce(message) {
  document.getElementById("status").textContent = message;
}

export const FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
export const DOMAIN_RE = /^[a-zA-Z0-9.-]+$/;

export function validFilename(name) {
  return name.length >= 1 && name.length <= 255 && FILENAME_RE.test(name) && !name.startsWith(".");
}

async function pollHealth() {
  const dot = document.getElementById("api-dot");
  const label = document.getElementById("api-label");
  try {
    await api("/api/health");
    dot.className = "size-2 rounded-full bg-emerald-400";
    label.textContent = "API terhubung";
  } catch {
    dot.className = "size-2 rounded-full bg-red-500";
    label.textContent = "API tidak tersedia";
  }
}

pollHealth();
setInterval(pollHealth, 30000);
