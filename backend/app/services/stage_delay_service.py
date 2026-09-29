import os
from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd

from app.schemas.stage_delay import StageDelayRequest


APP_DIR = Path(__file__).resolve().parents[1]

MODEL_ROOT = Path(
    os.getenv(
        "ACQUITWIN_MODEL_DIR",
        str(APP_DIR / "model_artifacts"),
    )
).expanduser().resolve()


MODEL_PATH = (
    MODEL_ROOT
    / "stage_delay"
    / "stage_delay_classifier.joblib"
)


FEATURES = [
    "current_stage",
    "state",
    "stage_index",
    "paf_count",
    "area",
    "open_litigations",
    "resolved_litigations",
    "compensation_pct",
    "rehabilitation_progress_pct",
    "days_in_current_stage",
    "prior_stage_avg_days",
]


@lru_cache(maxsize=1)
def load_stage_model():
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(
            f"Stage-delay model not found: {MODEL_PATH}"
        )

    return joblib.load(MODEL_PATH)


def predict_stage_delay(payload: StageDelayRequest):
    model = load_stage_model()

    inputs = payload.model_dump()

    frame = pd.DataFrame(
        [{feature: inputs[feature] for feature in FEATURES}]
    )

    # Identify the probability column corresponding to label 1.
    class_labels = list(model.classes_)

    if 1 not in class_labels:
        raise ValueError(
            "The stage-delay classifier has no positive class."
        )

    positive_index = class_labels.index(1)

    probability = float(
        model.predict_proba(frame)[0, positive_index]
    )

    threshold = 0.5

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