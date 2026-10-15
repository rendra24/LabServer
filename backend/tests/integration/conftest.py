"""Lingkungan integrasi nyata: nginx daemon, php-fpm 8.3 & 7.4, dan (opsional) container Docker.

Semua dilewati otomatis bila binary tidak ada. Container butuh image yang punya `sh` dan
`nc` (mis. busybox); set INTEGRATION_DOCKER_IMAGE (mis. busybox:latest) untuk mengaktifkannya.
"""
import os
import shutil
import socket
import stat
import subprocess
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from app.deps import get_file_service
from app.main import app
from app.services import curl_service
from app.services.file_service import FileService

NGINX = shutil.which("nginx")
FPM = {
    "8.3": "/opt/homebrew/opt/php@8.3/sbin/php-fpm",
    "7.4": "/opt/homebrew/opt/php@7.4/sbin/php-fpm",
}
DOCKER_IMAGE = os.environ.get("INTEGRATION_DOCKER_IMAGE")
CONTAINER_BODY = "docker-upstream-ok\n"  # 19 byte: Content-Length membuktikan asal respons


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_port(port: int, timeout: float = 15) -> None:
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket() as s:
            s.settimeout(0.3)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.1)
    raise RuntimeError(f"port {port} tidak terbuka")


def wait_http(port: int, timeout: float = 20) -> None:
    # docker-proxy membuka port sebelum proses di dalam container siap
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as r:
                if r.status == 200:
                    return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("container tidak merespons")


@dataclass
class Env:
    root: Path
    http_port: int
    fpm_ports: dict[str, int]
    docker_port: int | None
    nginx: subprocess.Popen
    fs: FileService
    docroots: dict[str, Path] = field(default_factory=dict)


def _script(path: Path, body: str) -> str:
    path.write_text("#!/bin/bash\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return str(path)


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    if not NGINX:
        pytest.skip("nginx tidak terpasang")
    for v, path in FPM.items():
        if not Path(path).exists():
            pytest.skip(f"php-fpm {v} tidak terpasang")
    root = tmp_path_factory.mktemp("runtime")
    procs: list[subprocess.Popen] = []
    container = None
    try:
        fpm_ports, docroots = {}, {}
        for v, binary in FPM.items():
            port = free_port()
            docroot = root / f"php{v.replace('.', '')}"
            docroot.mkdir()
            (docroot / "index.php").write_text(
                "<?php header('X-PHP-Version: ' . PHP_VERSION);"
                " header('X-PHP-SAPI: ' . php_sapi_name()); echo 'ok';"
            )
            conf = root / f"fpm{v}.conf"
            conf.write_text(
                f"[global]\npid = {root}/fpm{v}.pid\nerror_log = {root}/fpm{v}.log\n"
                f"daemonize = no\n[www]\nlisten = 127.0.0.1:{port}\npm = static\n"
                "pm.max_children = 2\n"
            )
            procs.append(
                subprocess.Popen([binary, "-y", str(conf), "-F"], stderr=subprocess.DEVNULL)
            )
            wait_port(port)
            fpm_ports[v], docroots[v] = port, docroot

        docker_port = None
        if DOCKER_IMAGE and shutil.which("docker"):
            docker_port = free_port()
            out = subprocess.run(
                [
                    "docker", "run", "-d", "--rm", "-p", f"127.0.0.1:{docker_port}:8080",
                    "--entrypoint", "sh", DOCKER_IMAGE, "-c",
                    "while true; do printf 'HTTP/1.1 200 OK\\r\\nContent-Length: "
                    f"{len(CONTAINER_BODY)}\\r\\nConnection: close\\r\\n\\r\\n"
                    f"{CONTAINER_BODY.strip()}\\n' | nc -l -p 8080; done",
                ],
                capture_output=True, text=True, timeout=120,
            )
            if out.returncode != 0:
                pytest.skip(f"container tidak bisa dijalankan: {out.stderr.strip()[:100]}")
            container = out.stdout.strip()
            wait_http(docker_port)

        available, enabled = root / "sites-available", root / "sites-enabled"
        available.mkdir()
        enabled.mkdir()
        tmp_dirs = " ".join(f"{p}_temp_path {root}/tmp-{p};" for p in ("client_body", "proxy", "fastcgi", "uwsgi", "scgi"))
        for p in ("client_body", "proxy", "fastcgi", "uwsgi", "scgi"):
            (root / f"tmp-{p}").mkdir()
        nginx_conf = root / "nginx.conf"
        nginx_conf.write_text(
            f"pid {root}/nginx.pid;\nerror_log {root}/nginx-error.log;\ndaemon off;\n"
            f"events {{}}\nhttp {{\n access_log off;\n {tmp_dirs}\n include {enabled}/*;\n}}\n"
        )
        http_port = free_port()
        nginx = subprocess.Popen(
            [NGINX, "-c", str(nginx_conf), "-p", str(root)], stderr=subprocess.DEVNULL
        )
        procs.append(nginx)
        time.sleep(0.5)
        yield Env(root, http_port, fpm_ports, docker_port, nginx, FileService(available, enabled), docroots)
    finally:
        if container:
            subprocess.run(["docker", "rm", "-f", container], capture_output=True)
        for p in procs:
            p.terminate()
        for p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()


@pytest.fixture
def env_client(env, client, monkeypatch):
    """Dashboard (DB uji + FileService menunjuk direktori nginx nyata) dengan wrapper
    sudo/nginx/systemctl yang menjalankan nginx sungguhan terhadap daemon uji."""
    nginx_args = f"-c {env.root}/nginx.conf -p {env.root}"
    sudo = _script(env.root / "sudo", '[ "$1" = "-n" ] && shift\nexec "$@"\n')
    nginx_t = _script(env.root / "nginx-t", f"exec {NGINX} -t {nginx_args}\n")
    reload_ = _script(env.root / "systemctl", f"exec {NGINX} -s reload {nginx_args}\n")
    s = curl_service.get_settings()
    monkeypatch.setattr(s, "sudo_bin", sudo)
    monkeypatch.setattr(s, "nginx_bin", nginx_t)
    monkeypatch.setattr(s, "systemctl_bin", reload_)
    monkeypatch.setattr(s, "curl_allowed_ports", str(env.http_port))
    app.dependency_overrides[get_file_service] = lambda: env.fs
    yield client
    for d in (env.fs.available, env.fs.enabled):
        for p in d.iterdir():
            p.unlink()
