from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.database.base import Base

# IMPORTANT:
# app/model/__init__.py must import every SQLAlchemy model.
# Importing app.model here registers all models with Base.metadata.
import app.model  # noqa: F401


# ============================================================
# ALEMBIC CONFIG
# ============================================================

config = context.config


# Use the PostgreSQL URL defined through backend/.env.
#
# Example generated URL:
# postgresql+psycopg://postgres:password@localhost:5432/land_acquisition_ai
#
# "%" must be escaped because Alembic uses ConfigParser internally.
config.set_main_option(
    "sqlalchemy.url",
    settings.database_url.replace("%", "%%"),
)


# ============================================================
# LOGGING
# ============================================================

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


# ============================================================
# SQLALCHEMY METADATA
# ============================================================

# Alembic compares this metadata against the current PostgreSQL
# database when --autogenerate is used.
target_metadata = Base.metadata


# ============================================================
# POSTGIS-MANAGED OBJECTS
# ============================================================

# These are managed by the PostGIS extension itself.
#
# Alembic must never try to create/drop/alter them.
POSTGIS_MANAGED_TABLES = {
    "spatial_ref_sys",
}


def include_object(
    object_,
    name,
    type_,
    reflected,
    compare_to,
):
    """
    Decide which database objects Alembic is allowed to manage.

    Parameters
    ----------
    object_:
        SQLAlchemy schema object.

    name:
        Database object name.

    type_:
        Object type such as:
        table
        column
        index
        unique_constraint
        foreign_key_constraint

    reflected:
        True when the object came from the existing database.

    compare_to:
        Matching SQLAlchemy metadata object, if one exists.

    Returns
    -------
    bool
        True  -> Alembic may manage the object.
        False -> Alembic ignores the object.
    """

    # Prevent Alembic from touching PostGIS system tables.
    if type_ == "table" and name in POSTGIS_MANAGED_TABLES:
        return False

    return True


# ============================================================
# OFFLINE MIGRATIONS
# ============================================================

def run_migrations_offline() -> None:
    """
    Run migrations in offline mode.

    Offline mode does not create a live database connection.
    Alembic generates SQL using only the configured database URL.
    """

    url = config.get_main_option("sqlalchemy.url")

    context.configure(
        url=url,
        target_metadata=target_metadata,

        # Required when Alembic generates literal SQL.
        literal_binds=True,

        dialect_opts={
            "paramstyle": "named",
        },

        # Protect PostGIS-owned objects.
        include_object=include_object,

        # Detect column datatype changes.
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


# ============================================================
# ONLINE MIGRATIONS
# ============================================================

def run_migrations_online() -> None:
    """
    Run migrations using a live PostgreSQL connection.
    """

    configuration = config.get_section(
        config.config_ini_section
    )

    if configuration is None:
        configuration = {}

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:

        context.configure(
            connection=connection,
            target_metadata=target_metadata,

            # Prevent Alembic from touching PostGIS-owned objects.
            include_object=include_object,

            # Detect datatype changes.
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


# ============================================================
# ALEMBIC ENTRY POINT
# ============================================================

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()