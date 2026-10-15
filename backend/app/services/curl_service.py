import ipaddress
import logging
import shlex
import subprocess

from app.config import get_settings
from app.errors import AppError
from app.schemas import CurlTestRequest

logger = logging.getLogger("app")

_MARKER = "__CURL__"
_PROCESS_TIMEOUT = 15
_CURL_MAX_TIME = "5"
_TLS_CODES = {35, 51, 58, 59, 60, 77, 83, 90, 91}
_ERRORS = {
    6: "Domain tidak dapat di-resolve (DNS gagal).",
    7: "Koneksi ditolak atau server tidak dapat dijangkau.",
    28: "Timeout: tidak ada respons dalam 5 detik.",
    35: "Handshake TLS gagal.",
    52: "Server menutup koneksi tanpa respons.",
    56: "Koneksi terputus saat menerima respons.",
    60: "Sertifikat SSL tidak tepercaya atau tidak cocok dengan domain.",
}


def _allowed_ports() -> set[int]:
    return {int(p) for p in get_settings().curl_allowed_ports.split(",") if p.strip()}


def _is_link_local(value: str | None) -> bool:
    try:
        return value is not None and ipaddress.ip_address(value).is_link_local
    except ValueError:
        return False  # bukan IP literal


def check_target(req: CurlTestRequest) -> None:
    """Guard SSRF di server: port allowlist dan blokir link-local (metadata cloud)."""
    if req.port not in _allowed_ports():
        raise AppError(
            400, "PORT_NOT_ALLOWED", f"Port {req.port} tidak diizinkan untuk pengujian."
        )
    if _is_link_local(req.resolve_ip) or _is_link_local(req.target_domain):
        raise AppError(400, "TARGET_NOT_ALLOWED", "Alamat tujuan tidak diizinkan untuk pengujian.")


def build_command(req: CurlTestRequest) -> list[str]:
    scheme = req.protocol.lower()
    cmd = [
        get_settings().curl_bin,
        "-s",
        "-S",
        "-o",
        "/dev/null",
        "-D",
        "-",
        "-w",
        f"\n{_MARKER}%{{http_code}}|%{{time_starttransfer}}|%{{time_total}}|%{{ssl_verify_result}}",
        "--max-time",
        _CURL_MAX_TIME,
        "--proto",
        "=http,https",  # redirect tidak diikuti; protokol lain ditolak
        "--noproxy",
        "*",
    ]
    if req.resolve_ip:
        ip = f"[{req.resolve_ip}]" if ":" in req.resolve_ip else req.resolve_ip
        cmd += ["--resolve", f"{req.target_domain}:{req.port}:{ip}"]
    for key, value in (req.custom_headers or {}).items():
        cmd += ["-H", f"{key}: {value}"]
    return [*cmd, "--", f"{scheme}://{req.target_domain}:{req.port}/"]


def _parse_headers(raw: str) -> dict[str, str]:
    blocks = [b for b in raw.replace("\r\n", "\n").split("\n\n") if b.strip()]
    headers: dict[str, str] = {}
    for line in (blocks[-1].split("\n") if blocks else [])[1:]:
        key, sep, value = line.partition(":")
        if sep:
            key, value = key.strip(), value.strip()
            headers[key] = f"{headers[key]}, {value}" if key in headers else value
    return headers


def _ssl_status(req: CurlTestRequest, rc: int) -> str:
    if req.protocol == "HTTP":
        return "N/A (HTTP)"
    if rc == 0:
        return "Valid (sertifikat terverifikasi)"
    if rc in _TLS_CODES:
        return "Gagal (handshake/verifikasi sertifikat)"
    return "Tidak diketahui (koneksi gagal sebelum handshake)"


def _failure(command: str, error: str, req: CurlTestRequest, raw: str = "") -> dict:
    return {
        "is_success": False,
        "status_code": 0,
        "ttfb_ms": 0.0,
        "total_ms": 0.0,
        "headers": {},
        "ssl_status": _ssl_status(req, 1) if req.protocol == "HTTPS" else "N/A (HTTP)",
        "raw_output": raw,
        "command": command,
        "error": error,
    }


def run_curl_test(req: CurlTestRequest) -> dict:
    argv = build_command(req)
    command = shlex.join(argv)
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=_PROCESS_TIMEOUT)
    except subprocess.TimeoutExpired:
        return _failure(command, "Pengujian melewati batas waktu.", req)
    except OSError:
        logger.exception("curl tidak dapat dijalankan")
        return _failure(command, "curl tidak dapat dijalankan di server ini.", req)

    raw, _, tail = proc.stdout.rpartition(f"\n{_MARKER}")
    if not tail:
        return _failure(command, "Output curl tidak dapat dibaca.", req, proc.stderr.strip())
    try:
        code, ttfb, total, _verify = tail.strip().split("|")
        status_code, ttfb_ms, total_ms = int(code), float(ttfb) * 1000, float(total) * 1000
    except ValueError:
        return _failure(command, "Output curl tidak dapat dibaca.", req, proc.stderr.strip())

    ok = proc.returncode == 0
    error = None if ok else _ERRORS.get(proc.returncode, f"curl gagal (kode {proc.returncode}).")
    parts = [raw.strip()] + ([] if ok else [proc.stderr.strip()])
    raw_output = "\n".join(x for x in parts if x)
    return {
        "is_success": ok,
        "status_code": status_code,
        "ttfb_ms": round(ttfb_ms, 1),
        "total_ms": round(total_ms, 1),
        "headers": _parse_headers(raw) if ok else {},
        "ssl_status": _ssl_status(req, proc.returncode),
        "raw_output": raw_output,
        "command": command,
        "error": error,
    }
