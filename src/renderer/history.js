// Snapshot terakhir dibaca dari proses utama (hanya baca; penulisan terjadi di main setelah pembacaan live sukses).
const stamp = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

export async function readHistory(owner, feature) {
  try {
    const saved = await window.api.history.get(owner.id, feature);
    return saved && saved.data !== undefined && saved.recordedAt ? saved : null;
  } catch { return null; }
}

// state: 'refreshing' | 'failed' | 'cancelled'; recordedAt kosong menyembunyikan label.
export function historyLabel(node, recordedAt, state) {
  if (!node) return;
  if (!recordedAt) { node.textContent = ''; node.hidden = true; return; }
  const suffix = state === 'refreshing' ? ' · memperbarui…' : state === 'failed' ? ' · pembaruan gagal, data lama ditampilkan' : '';
  node.textContent = `Data terakhir ${stamp.format(new Date(recordedAt))}${suffix}`;
  node.hidden = false;
}
