"""Task 4.2 (vhost -> PHP 8.3-FPM / PHP 7.4-FPM / Docker) dan 4.3 (sintaks rusak tanpa downtime).

Semua lewat API dashboard, dengan nginx/php-fpm/curl sungguhan.
"""
import threading
import time
import urllib.request

import pytest

from tests.integration.conftest import CONTAINER_BODY


def php_conf(port: int, docroot, fpm_port: int, domain: str) -> str:
    return f"""server {{
    listen {port};
    server_name {domain};
    root {docroot};
    location / {{ try_files $uri /index.php$is_args$args; }}
    location ~ \\.php$ {{
        fastcgi_pass 127.0.0.1:{fpm_port};
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param REQUEST_METHOD $request_method;
        fastcgi_param QUERY_STRING $query_string;
    }}
}}
"""


def proxy_conf(port: int, upstream: int, domain: str) -> str:
    return f"""server {{
    listen {port};
    server_name {domain};
    location / {{ proxy_pass http://127.0.0.1:{upstream}; }}
}}
"""


def add_site(client, filename, domain, content, enable=True):
    r = client.post(
        "/api/v1/sites", json={"filename": filename, "content": content, "domain_name": domain}
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    if enable:
        assert client.post(f"/api/v1/sites/{sid}/toggle").json()["is_enabled"] is True
    return sid


def nginx_test_ok(client):
    r = client.post("/api/v1/nginx/test")
    assert r.status_code == 200 and r.json()["is_success"], r.text


def reload_ok(client):
    nginx_test_ok(client)
    r = client.post("/api/v1/nginx/reload")
    assert r.status_code == 200 and r.json()["is_success"], r.text


def curl(client, env, domain):
    r = client.post(
        "/api/v1/curl/test",
        json={
            "target_domain": domain,
            "resolve_ip": "127.0.0.1",
            "port": env.http_port,
            "protocol": "HTTP",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def runtime_sites(env, env_client):
    c = env_client
    add_site(c, "app-php83.local", "app-php83.local",
             php_conf(env.http_port, env.docroots["8.3"], env.fpm_ports["8.3"], "app-php83.local"))
    add_site(c, "legacy-php74.local", "legacy-php74.local",
             php_conf(env.http_port, env.docroots["7.4"], env.fpm_ports["7.4"], "legacy-php74.local"))
    if env.docker_port:
        add_site(c, "docker.local", "docker.local",
                 proxy_conf(env.http_port, env.docker_port, "docker.local"))
    reload_ok(c)
    return c


def test_vhosts_reach_php83_php74_and_docker_through_curl_tester(env, runtime_sites):
    c = runtime_sites
    r83 = curl(c, env, "app-php83.local")
    assert r83["is_success"] and r83["status_code"] == 200
    assert r83["headers"]["X-PHP-Version"].startswith("8.3.")
    assert r83["headers"]["X-PHP-SAPI"] == "fpm-fcgi"  # benar-benar lewat FastCGI

    r74 = curl(c, env, "legacy-php74.local")
    assert r74["status_code"] == 200 and r74["headers"]["X-PHP-Version"].startswith("7.4.")

    # dua vhost, satu port: dibedakan murni oleh --resolve + header Host
    assert r83["headers"]["X-PHP-Version"] != r74["headers"]["X-PHP-Version"]


def test_reverse_proxy_to_docker_container(env, runtime_sites):
    if not env.docker_port:
        pytest.skip("set INTEGRATION_DOCKER_IMAGE untuk menguji container")
    c = runtime_sites
    ok = curl(c, env, "docker.local")
    assert ok["status_code"] == 200
    assert ok["headers"]["Content-Length"] == str(len(CONTAINER_BODY))  # dari container
    # kontras: host yang tidak dikenal tidak sampai ke container
    other = curl(c, env, "tidak-ada.local")
    assert other["status_code"] != 200 or other["headers"].get("Content-Length") != str(
        len(CONTAINER_BODY)
    )


def test_unknown_domain_without_resolve_fails_clearly(env, runtime_sites):
    r = runtime_sites.post(
        "/api/v1/curl/test",
        json={"target_domain": "app-php83.invalid", "port": env.http_port, "protocol": "HTTP"},
    )
    d = r.json()
    assert d["is_success"] is False and "resolve" in d["error"].lower()  # tanpa --resolve: DNS gagal


class Hammer(threading.Thread):
    """Mengirim request terus-menerus ke daemon nginx untuk mendeteksi downtime."""

    def __init__(self, port, host):
        super().__init__(daemon=True)
        self.port, self.host = port, host
        self.stop_flag = threading.Event()
        self.ok = self.failed = 0

    def run(self):
        while not self.stop_flag.is_set():
            req = urllib.request.Request(f"http://127.0.0.1:{self.port}/", headers={"Host": self.host})
            try:
                with urllib.request.urlopen(req, timeout=2) as resp:
                    self.ok += resp.status == 200
            except Exception:
                self.failed += 1
            time.sleep(0.02)


def test_broken_config_blocks_reload_without_downtime_and_is_audited(env, runtime_sites):
    c = runtime_sites
    sid = c.get("/api/v1/sites").json()["items"][0]["id"]
    site = next(s for s in c.get("/api/v1/sites").json()["items"] if s["filename"] == "app-php83.local")
    sid = site["id"]
    good = c.get(f"/api/v1/sites/{sid}").json()["content"]
    master_pid = env.nginx.pid

    hammer = Hammer(env.http_port, "app-php83.local")
    hammer.start()
    try:
        time.sleep(0.3)
        # simpan konfigurasi rusak ke vhost yang sedang aktif
        broken = good.replace("listen", "bogus_directive on;\n    listen", 1)
        assert c.put(f"/api/v1/sites/{sid}", json={"content": broken}).status_code == 200

        t = c.post("/api/v1/nginx/test").json()
        assert t["is_success"] is False and "bogus_directive" in t["stderr"]

        r = c.post("/api/v1/nginx/reload")  # UI dilewati: server tetap menolak
        assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_SYNTAX"
        assert "bogus_directive" in r.json()["error"]["details"]

        # daemon masih melayani dengan konfigurasi lama yang sehat
        alive = curl(c, env, "app-php83.local")
        assert alive["status_code"] == 200 and alive["headers"]["X-PHP-Version"].startswith("8.3.")
        assert env.nginx.poll() is None and env.nginx.pid == master_pid

        logs = c.get("/api/v1/audit-logs?is_success=false").json()["items"]
        kinds = {(x["action_type"], x["site_filename"]) for x in logs}
        assert ("NGINX_TEST", None) in kinds and ("NGINX_RELOAD", None) in kinds
        reload_log = next(x for x in logs if x["action_type"] == "NGINX_RELOAD")
        assert "bogus_directive" in reload_log["execution_output"]

        # pulihkan: tes lolos lagi dan reload diizinkan
        assert c.put(f"/api/v1/sites/{sid}", json={"content": good}).status_code == 200
        reload_ok(c)
    finally:
        time.sleep(0.3)
        hammer.stop_flag.set()
        hammer.join(timeout=3)

    assert hammer.ok > 20, "beban uji terlalu sedikit untuk menyimpulkan"
    assert hammer.failed == 0, f"{hammer.failed} request gagal selama skenario sintaks rusak"
