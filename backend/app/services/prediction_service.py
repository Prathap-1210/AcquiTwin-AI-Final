from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd


# ============================================================
# PATHS
# ============================================================

APP_DIR = Path(__file__).resolve().parents[1]

MODEL_ROOT = Path(
    os.getenv(
        "ACQUITWIN_MODEL_DIR",
        str(APP_DIR / "model_artifacts"),
    )
).expanduser().resolve()


CLASSIFIER_MODEL_FILE = (
    MODEL_ROOT
    / "project_delay"
    / "best_model.joblib"
)

DELAY_MODEL_FILE = (
    MODEL_ROOT
    / "project_delay"
    / "delay_days_best_model.joblib"
)

FEATURE_METADATA_FILE = (
    MODEL_ROOT
    / "project_delay"
    / "feature_metadata.json"
)


# ============================================================
# MODEL CACHE
# ============================================================

_classifier = None
_delay_model = None
_feature_metadata = None


# ============================================================
# LOADERS
# ============================================================

def get_classifier():

    global _classifier

    if _classifier is None:

        if not CLASSIFIER_MODEL_FILE.exists():

            raise FileNotFoundError(
                f"Classifier not found:\n"
                f"{CLASSIFIER_MODEL_FILE}"
            )

        _classifier = joblib.load(
            CLASSIFIER_MODEL_FILE
        )

    return _classifier


def get_delay_model():

    global _delay_model

    if _delay_model is None:

        if not DELAY_MODEL_FILE.exists():

            raise FileNotFoundError(
                f"Delay model not found:\n"
                f"{DELAY_MODEL_FILE}"
            )

        _delay_model = joblib.load(
            DELAY_MODEL_FILE
        )

    return _delay_model


def get_feature_metadata():

    global _feature_metadata

    if _feature_metadata is None:

        if not FEATURE_METADATA_FILE.exists():

            raise FileNotFoundError(
                f"Feature metadata not found:\n"
                f"{FEATURE_METADATA_FILE}"
            )

        with FEATURE_METADATA_FILE.open(
            "r",
            encoding="utf-8",
        ) as file:

            _feature_metadata = json.load(
                file
            )

    return _feature_metadata


# ============================================================
# RISK LEVEL
# ============================================================

def get_risk_level(
    probability: float,
) -> str:

    if probability >= 0.70:
        return "HIGH"

    if probability >= 0.40:
        return "MEDIUM"

    return "LOW"


# ============================================================
# FEATURE PREPARATION
# ============================================================

def prepare_features(
    payload: dict[str, Any],
) -> pd.DataFrame:

    data = dict(payload)

    metadata = get_feature_metadata()

    required_features = metadata[
        "features"
    ]

    # --------------------------------------------------------
    # Derive land acquisition percentage if frontend sends
    # acquired_land_area instead.
    # --------------------------------------------------------

    if (
        "land_acquisition_percentage"
        not in data
    ):

        if (
            "total_land_area" in data
            and "acquired_land_area" in data
        ):

            total = float(
                data["total_land_area"]
            )

            acquired = float(
                data["acquired_land_area"]
            )

            if total > 0:

                data[
                    "land_acquisition_percentage"
                ] = max(
                    0.0,
                    min(
                        100.0,
                        (
                            acquired
                            / total
                        )
                        * 100,
                    ),
                )

            else:

                data[
                    "land_acquisition_percentage"
                ] = 0.0

    # --------------------------------------------------------
    # Check missing features
    # --------------------------------------------------------

    missing = [
        feature
        for feature in required_features
        if feature not in data
    ]

    if missing:

        raise ValueError(
            "Missing prediction features: "
            + ", ".join(missing)
        )

    # --------------------------------------------------------
    # Keep exact training feature order
    # --------------------------------------------------------

    row = {
        feature: data[feature]
        for feature in required_features
    }

    return pd.DataFrame(
        [row]
    )


# ============================================================
# EXPLANATION HELPERS
# ============================================================

def clean_transformed_name(
    name: str,
) -> str:

    return (
        name
        .replace(
            "categorical__",
            "",
        )
        .replace(
            "numeric__",
            "",
        )
    )


def transformed_to_base_feature(
    transformed_name: str,
    categorical_features: list[str],
) -> str:

    cleaned = clean_transformed_name(
        transformed_name
    )

    for feature in sorted(
        categorical_features,
        key=len,
        reverse=True,
    ):

        prefix = f"{feature}_"

        if cleaned.startswith(
            prefix
        ):

            return feature

    return cleaned


# ============================================================
# LOGISTIC CONTRIBUTION EXPLANATION
# ============================================================

def explain_prediction(
    input_df: pd.DataFrame,
    top_n: int = 8,
) -> list[dict[str, Any]]:

    classifier = get_classifier()

    metadata = get_feature_metadata()

    preprocessor = classifier.named_steps[
        "preprocessor"
    ]

    model = classifier.named_steps[
        "model"
    ]

    if (
        type(model).__name__
        != "LogisticRegression"
    ):

        return []

    transformed = preprocessor.transform(
        input_df
    )

    if hasattr(
        transformed,
        "toarray",
    ):

        transformed = (
            transformed.toarray()
        )

    transformed = np.asarray(
        transformed
    )

    feature_names = (
        preprocessor
        .get_feature_names_out()
    )

    coefficients = (
        model.coef_[0]
    )

    values = transformed[0]

    contributions = (
        values
        * coefficients
    )

    # --------------------------------------------------------
    # Aggregate one-hot encoded categories back to their
    # original feature names.
    # --------------------------------------------------------

    aggregated: dict[
        str,
        float,
    ] = {}

    categorical_features = metadata[
        "categorical_features"
    ]

    for (
        transformed_name,
        contribution,
    ) in zip(
        feature_names,
        contributions,
    ):

        base_feature = (
            transformed_to_base_feature(
                transformed_name,
                categorical_features,
            )
        )

        aggregated[
            base_feature
        ] = (
            aggregated.get(
                base_feature,
                0.0,
            )
            + float(
                contribution
            )
        )

    explanations = []

    for (
        feature,
        contribution,
    ) in aggregated.items():

        original_value = (
            input_df.iloc[0][
                feature
            ]
            if feature
            in input_df.columns
            else None
        )

        if isinstance(
            original_value,
            np.generic,
        ):

            original_value = (
                original_value.item()
            )

        if contribution > 0:

            direction = (
                "INCREASES_DELAY_RISK"
            )

        elif contribution < 0:

            direction = (
                "REDUCES_DELAY_RISK"
            )

        else:

            direction = "NEUTRAL"

        explanations.append(
            {
                "feature": feature,
                "value": original_value,
                "contribution": round(
                    contribution,
                    6,
                ),
                "absolute_contribution": round(
                    abs(
                        contribution
                    ),
                    6,
                ),
                "direction": direction,
            }
        )

    explanations.sort(
        key=lambda item: (
            item[
                "absolute_contribution"
            ]
        ),
        reverse=True,
    )

    return explanations[
        :top_n
    ]


# ============================================================
# MAIN PREDICTION
# ============================================================

def predict_project_delay(
    payload: dict[str, Any],
) -> dict[str, Any]:

    classifier = get_classifier()

    delay_model = get_delay_model()

    input_df = prepare_features(
        payload
    )

    # ========================================================
    # DELAY CLASSIFICATION
    # ========================================================

    probability = float(
        classifier.predict_proba(
            input_df
        )[0][1]
    )

    predicted_class = int(
        probability >= 0.50
    )

    risk_score = round(
        probability * 100,
        2,
    )

    risk_level = get_risk_level(
        probability
    )

    # ========================================================
    # DELAY DURATION
    #
    # Regressor was trained only on delayed projects.
    # Therefore this is conditional on a delay occurring.
    # ========================================================

    conditional_delay_days = float(
        delay_model.predict(
            input_df
        )[0]
    )

    conditional_delay_days = max(
        0.0,
        conditional_delay_days,
    )

    conditional_delay_days = round(
        conditional_delay_days
    )

    # --------------------------------------------------------
    # Expected delay combines:
    #
    # P(delay) × delay duration if delay occurs
    # --------------------------------------------------------

    expected_delay_days = round(
        probability
        * conditional_delay_days
    )

    # ========================================================
    # EXPLANATION
    # ========================================================

    factors = explain_prediction(
        input_df,
        top_n=8,
    )

    risk_increasing = [
        factor
        for factor in factors
        if factor["direction"]
        == "INCREASES_DELAY_RISK"
    ]

    risk_reducing = [
        factor
        for factor in factors
        if factor["direction"]
        == "REDUCES_DELAY_RISK"
    ]

    # ========================================================
    # RESPONSE
    # ========================================================

    return {

        "prediction": {

            "delay_probability": round(
                probability,
                6,
            ),

            "delay_probability_percent":
                round(
                    probability
                    * 100,
                    2,
                ),

            "predicted_delay_status":
                predicted_class,

            "predicted_delay":
                bool(
                    predicted_class
                ),

            "risk_score":
                risk_score,

            "risk_level":
                risk_level,

            "conditional_delay_days":
                int(
                    conditional_delay_days
                ),

            "expected_delay_days":
                int(
                    expected_delay_days
                ),
        },

        "explanation": {

            "method":
                "logistic_feature_contribution",

            "top_factors":
                factors,

            "risk_increasing_factors":
                risk_increasing,

            "risk_reducing_factors":
                risk_reducing,

            "note": (
                "Feature contributions are "
                "logistic-model contributions "
                "in log-odds space."
            ),
        },

        "model": {

            "classifier":
                "LogisticRegression",

            "delay_regressor":
                "Ridge",

            "classifier_cv_accuracy":
                0.8397,

            "classifier_cv_roc_auc":
                0.9165,

            "delay_regressor_mae_days":
                25.75,

            "prototype_data":
                "synthetic",
        },
    }