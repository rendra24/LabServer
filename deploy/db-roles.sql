-- Role runtime dashboard (hak minimum). Jalankan SETELAH `alembic upgrade head`, sebagai superuser
-- (perlu CREATE ROLE; role pemilik tabel biasa tidak cukup):
--   sudo -u postgres psql -d dashboard_server -v app_role=dashboard_app -v app_password='GANTI' -f deploy/db-roles.sql
-- audit_logs append-only: hanya SELECT + INSERT (PERMISSIONS.md). FK ON DELETE SET NULL tetap
-- berjalan karena aksi referensial dieksekusi dengan hak pemilik tabel.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_role', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_role') \gexec

GRANT USAGE ON SCHEMA public TO :"app_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON sites, test_profiles TO :"app_role";
GRANT SELECT, INSERT ON audit_logs TO :"app_role";
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
