// State bersama antar-view dan navigasi sederhana (satu halaman, tiga view).
export const app = {
  server: null, // profil server yang sedang dibuka
  syntaxValid: false, // hasil nginx -t terakhir masih berlaku (direset oleh setiap perubahan)
  canRemember: false,
};

const VIEWS = ["servers", "sites", "editor"];
const listeners = {};

export function show(view, params) {
  for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
  listeners[view]?.(params);
  document.getElementById(`view-${view}`).querySelector("h1")?.focus();
}

export const onShow = (view, fn) => (listeners[view] = fn);

/** Setiap perubahan di server membatalkan hasil nginx -t sebelumnya. */
export const invalidateSyntax = () => (app.syntaxValid = false);
