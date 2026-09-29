from functools import lru_cache

import joblib
import pandas as pd

from app.schemas.stage_delay import StageDelayRequest
from app.services.model_registry import get_model_path


# ============================================================
# MODEL LOCATION
# ============================================================

MODEL_PATH = get_model_path(
    "stage_delay",
    "classifier",
)


# ============================================================
# MODEL INPUT FEATURES
# ============================================================

FEATURES = [
    "current_stage",
    "stage_index",
    "state",
    "paf_count",
    "area",
    "open_litigations",
    "resolved_litigations",
    "compensation_pct",
    "rehabilitation_progress_pct",
    "days_in_current_stage",
    "prior_stage_avg_days",
]


# ============================================================
# HELPERS
# ============================================================

def _is_git_lfs_pointer(path) -> bool:
    """
    Returns True when the .joblib file is only a Git LFS pointer
    instead of the actual trained model.
    """

    try:
        with path.open("rb") as file:
            beginning = file.read(200)

        return b"git-lfs.github.com/spec/v1" in beginning

    except OSError:
        return False


# ============================================================
# MODEL LOADER
# ============================================================

@lru_cache(maxsize=1)
def get_stage_delay_model():
    """
    Load the trained stage-delay classifier.

    The model is cached so it is loaded only once while the
    FastAPI process is running.
    """

    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"Stage-delay classifier not found: {MODEL_PATH}"
        )

    if _is_git_lfs_pointer(MODEL_PATH):
        raise RuntimeError(
            "Stage-delay classifier is only a Git LFS pointer. "
            f"Replace it with the real trained model: {MODEL_PATH}"
        )

    try:
        model = joblib.load(MODEL_PATH)

    except Exception as exc:
        raise RuntimeError(
            f"Unable to load stage-delay classifier: {MODEL_PATH}"
        ) from exc

    return model


# ============================================================
# INPUT PREPARATION
# ============================================================

def prepare_stage_delay_features(
    request: StageDelayRequest,
) -> pd.DataFrame:
    """
    Convert StageDelayRequest into the exact feature DataFrame
    expected by the stage-delay ML model.
    """

    values = request.model_dump()

    missing_features = [
        feature
        for feature in FEATURES
        if feature not in values
    ]

    if missing_features:
        raise ValueError(
            "Missing stage-delay model features: "
            + ", ".join(missing_features)
        )

    row = {
        feature: values[feature]
        for feature in FEATURES
    }

    dataframe = pd.DataFrame(
        [row],
        columns=FEATURES,
    )

    return dataframe


# ============================================================
# PREDICTION
# ============================================================

def predict_stage_delay(
    request: StageDelayRequest,
) -> dict:
    """
    Run the stage-delay classifier.

    Returns:
        stage_delay_probability
        stage_delay_probability_percent
        predicted_delay_label
        classification_threshold
    """

    model = get_stage_delay_model()

    features = prepare_stage_delay_features(request)

    if not hasattr(model, "predict_proba"):
        raise RuntimeError(
            "Stage-delay classifier does not support predict_proba()."
        )

    probabilities = model.predict_proba(features)

    # --------------------------------------------------------
    # Locate probability for positive/delay class.
    # Usually the classes are [0, 1].
    # --------------------------------------------------------

    classes = getattr(model, "classes_", None)

    if classes is not None:
        classes_list = list(classes)

        if 1 in classes_list:
            positive_index = classes_list.index(1)
        elif True in classes_list:
            positive_index = classes_list.index(True)
        else:
            positive_index = len(classes_list) - 1

    else:
        # Normal binary classifier predict_proba output:
        # [probability_class_0, probability_class_1]
        positive_index = 1

    probability = float(
        probabilities[0][positive_index]
    )

    # Safety clamp
    probability = max(
        0.0,
        min(1.0, probability),
    )

    threshold = 0.50

    predicted_label = int(
        probability >= threshold
    )

    return {
        "stage_delay_probability": round(
            probability,
            6,
        ),
        "stage_delay_probability_percent": round(
            probability * 100,
            2,
        ),
        "predicted_delay_label": predicted_label,
        "classification_threshold": threshold,
    }