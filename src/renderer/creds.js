import { askSecret } from "./ui.js";

const NEED = { NEED_PASSWORD: "password", NEED_PASSPHRASE: "passphrase", BAD_PASSPHRASE: "passphrase" };

/**
 * Jalankan attempt(creds) dan minta password/passphrase bila server memintanya.
 * Resolve hasil terakhir ({ok,...}) atau null bila pengguna membatalkan.
 */
export async function withCredentials(server, attempt, canRemember) {
  const creds = {};
  for (let i = 0; i < 4; i++) {
    const r = await attempt(creds);
    const need = r.code === "AUTH_FAILED" && server.auth === "password" ? "password" : NEED[r.code];
    if (r.ok || !need) return r;
    const isPass = need === "password";
    const answer = await askSecret({
      title: isPass ? "Password SSH" : "Passphrase private key",
      label: isPass ? "Password" : "Passphrase",
      description: r.code.startsWith("NEED_") ? `${server.username}@${server.host}` : r.message,
      allowRemember: canRemember,
    });
    if (!answer) return null;
    creds[need] = answer.value;
    creds.remember = answer.remember;
  }
  return null;
}
