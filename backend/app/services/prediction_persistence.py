from __future__ import annotations

from typing import Any

from app.database.session import SessionLocal
from app.model.prediction import Prediction
from app.model.risk_factor import RiskFactor
from app.model.project import Project


MODEL_VERSION = "project-delay-logistic-v1"


def save_prediction_result(
    project_db_id: int,
    input_payload: dict[str, Any],
    result: dict[str, Any],
) -> int:
    """
    Save one ML prediction and its explainability factors.

    Returns:
        Database prediction ID.
    """

    db = SessionLocal()

    try:
        # ====================================================
        # 1. VERIFY PROJECT EXISTS
        # ====================================================

        project = (
            db.query(Project)
            .filter(Project.id == project_db_id)
            .first()
        )

        if project is None:
            raise ValueError(
                f"Project with database ID "
                f"{project_db_id} does not exist."
            )

        # ====================================================
        # 2. EXTRACT PREDICTION RESULT
        # ====================================================

        prediction_data = result["prediction"]

        probability = float(
            prediction_data["delay_probability"]
        )

        # Confidence = distance from uncertainty boundary 0.5
        confidence_score = round(
            abs(probability - 0.5) * 2,
            6,
        )

        # ====================================================
        # 3. SAVE PREDICTION
        # ====================================================

        prediction = Prediction(
            project_id=project_db_id,

            model_version=MODEL_VERSION,

            delay_probability=probability,

            risk_score=float(
                prediction_data["risk_score"]
            ),

            risk_level=str(
                prediction_data["risk_level"]
            ),

            predicted_delay_days=int(
                prediction_data[
                    "expected_delay_days"
                ]
            ),

            confidence_score=confidence_score,

            # We do not yet have calibrated confidence bounds.
            lower_bound=None,
            upper_bound=None,

            input_snapshot=input_payload,
        )

        db.add(prediction)

        # Flush so prediction.id is generated before
        # inserting RiskFactor rows.
        db.flush()

        prediction_id = prediction.id

        # ====================================================
        # 4. SAVE TOP RISK FACTORS
        # ====================================================

        factors = (
            result
            .get("explanation", {})
            .get("top_factors", [])
        )

        for rank, factor in enumerate(
            factors,
            start=1,
        ):

            value = factor.get("value")

            if value is None:
                feature_value = None
            else:
                feature_value = str(value)

            risk_factor = RiskFactor(
                prediction_id=prediction_id,

                feature_name=str(
                    factor.get(
                        "feature",
                        "unknown",
                    )
                ),

                feature_value=feature_value,

                contribution=float(
                    factor.get(
                        "contribution",
                        0.0,
                    )
                ),

                importance_rank=rank,

                direction=str(
                    factor.get(
                        "direction",
                        "NEUTRAL",
                    )
                ),
            )

            db.add(risk_factor)

        # ====================================================
        # 5. COMMIT TRANSACTION
        # ====================================================

        db.commit()

        return prediction_id

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()