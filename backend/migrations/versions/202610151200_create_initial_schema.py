"""create initial schema (sites, test_profiles, audit_logs)

Revision ID: 202610151200
Revises:
Create Date: 2026-10-15 12:00:00
"""
from alembic import op

revision = "202610151200"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE sites (
        id SERIAL CONSTRAINT pk_sites PRIMARY KEY,
        filename VARCHAR(255) NOT NULL CONSTRAINT uq_sites_filename UNIQUE,
        domain_name VARCHAR(255) NOT NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    op.execute("CREATE INDEX idx_sites_filename ON sites(filename)")
    op.execute("CREATE INDEX idx_sites_is_enabled ON sites(is_enabled)")

    op.execute("""
    CREATE TABLE test_profiles (
        id SERIAL CONSTRAINT pk_test_profiles PRIMARY KEY,
        site_id INTEGER NOT NULL CONSTRAINT fk_test_profiles_site_id
            REFERENCES sites(id) ON DELETE CASCADE,
        target_domain VARCHAR(255) NOT NULL,
        resolve_ip VARCHAR(45) NOT NULL,
        port INTEGER NOT NULL DEFAULT 80
            CONSTRAINT chk_test_profiles_port CHECK (port > 0 AND port <= 65535),
        custom_headers TEXT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    op.execute("CREATE INDEX idx_test_profiles_site_id ON test_profiles(site_id)")

    op.execute("""
    CREATE TABLE audit_logs (
        id SERIAL CONSTRAINT pk_audit_logs PRIMARY KEY,
        site_id INTEGER NULL CONSTRAINT fk_audit_logs_site_id
            REFERENCES sites(id) ON DELETE SET NULL,
        action_type VARCHAR(50) NOT NULL,
        command_executed TEXT NOT NULL,
        execution_output TEXT NULL,
        is_success BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    op.execute("CREATE INDEX idx_audit_logs_site_id ON audit_logs(site_id)")
    op.execute("CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC)")
    op.execute("CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type)")


def downgrade() -> None:
    op.execute("DROP TABLE audit_logs")
    op.execute("DROP TABLE test_profiles")
    op.execute("DROP TABLE sites")
