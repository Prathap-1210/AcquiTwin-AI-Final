import os
from pathlib import Path
from typing import Any

import yaml


# ============================================================
# APPLICATION PATHS
# ============================================================

APP_DIR = Path(__file__).resolve().parents[1]

APP_MODEL_ARTIFACT_DIR = (
    APP_DIR / "model_artifacts"
).resolve()


# ============================================================
# MODEL ROOT
#
# Local:
#   D:\AcquiTwin-ML\models
#
# Railway:
#   backend/app/model_artifacts
# ============================================================

MODEL_ROOT = Path(
    os.getenv(
        "ACQUITWIN_MODEL_DIR",
        str(APP_MODEL_ARTIFACT_DIR),
    )
).expanduser().resolve()


# ============================================================
# REGISTRY LOCATION
#
# Registry remains with the application even when the models
# are stored externally.
# ============================================================

REGISTRY_FILE = Path(
    os.getenv(
        "ACQUITWIN_MODEL_REGISTRY",
        str(
            APP_MODEL_ARTIFACT_DIR
            / "model_registry.yaml"
        ),
    )
).expanduser().resolve()


# ============================================================
# LOAD REGISTRY
# ============================================================

def load_registry() -> dict[str, Any]:

    if not REGISTRY_FILE.exists():
        raise RuntimeError(
            f"Model registry not found: {REGISTRY_FILE}"
        )

    try:
        with REGISTRY_FILE.open(
            "r",
            encoding="utf-8",
        ) as file:
            registry = yaml.safe_load(file)

    except yaml.YAMLError as exc:
        raise RuntimeError(
            f"Invalid YAML in model registry: "
            f"{REGISTRY_FILE}"
        ) from exc

    if not isinstance(registry, dict):
        raise RuntimeError(
            "model_registry.yaml must contain "
            "a YAML mapping."
        )

    return registry


REGISTRY = load_registry()


# ============================================================
# MODEL PATH RESOLVER
# ============================================================

def get_model_path(
    section: str,
    model_name: str,
) -> Path:

    try:
        config = REGISTRY[section][model_name]

    except KeyError as exc:
        raise RuntimeError(
            f"Model configuration missing: "
            f"{section}.{model_name}"
        ) from exc

    if not isinstance(config, dict):
        raise RuntimeError(
            f"Invalid model configuration: "
            f"{section}.{model_name}"
        )

    relative_file = config.get("file")

    if not relative_file:
        raise RuntimeError(
            f"Model file not configured: "
            f"{section}.{model_name}"
        )

    model_path = (
        MODEL_ROOT
        / relative_file
    ).resolve()

    # Prevent paths such as ../../something
    # from escaping MODEL_ROOT.
    try:
        model_path.relative_to(MODEL_ROOT)

    except ValueError as exc:
        raise RuntimeError(
            f"Invalid model path outside "
            f"MODEL_ROOT: {model_path}"
        ) from exc

    return model_path