from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select

from app.database.session import SessionLocal
from app.model.prediction import Prediction
from app.schemas.prediction import ProjectDelayPredictionRequest
from app.services.prediction_service import predict_project_delay


# ============================================================
# ROUTER
# ============================================================

router = APIRouter(
    prefix="/api/v1/simulations",
    tags=["What-If Simulation"],
)


# ============================================================
# REQUEST SCHEMA
# ============================================================

class WhatIfRequest(BaseModel):
    project_db_id: int = Field(ge=1)

    # Only changed values need to be submitted.
    # The remaining inputs come from the latest saved snapshot.
    changes: dict[str, Any] = Field(
        min_length=1,
        max_length=31,
    )


# ============================================================
# ALLOWED MODEL FEATURES
# ============================================================

ALLOWED_FEATURES = (
    set(ProjectDelayPredictionRequest.model_fields)
    - {"project_db_id"}
)


# ============================================================
# SIMULATION ENDPOINT
# ============================================================

@router.post("/what-if")
def run_what_if(request: WhatIfRequest):

    # --------------------------------------------------------
    # 1. VALIDATE THE REQUESTED FEATURE NAMES
    # --------------------------------------------------------

    unknown_features = (
        set(request.changes) - ALLOWED_FEATURES
    )

    if unknown_features:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Unknown or prohibited feature names.",
                "fields": sorted(unknown_features),
            },
        )

    # --------------------------------------------------------
    # 2. READ THE LATEST SAVED PREDICTION
    # --------------------------------------------------------

    with SessionLocal() as db:

        latest_prediction = db.scalar(
            select(Prediction)
            .where(
                Prediction.project_id == request.project_db_id
            )
            .order_by(Prediction.id.desc())
            .limit(1)
        )

        if latest_prediction is None:
            raise HTTPException(
                status_code=404,
                detail="No saved prediction found for this project.",
            )

        if not isinstance(
            latest_prediction.input_snapshot,
            dict,
        ):
            raise HTTPException(
                status_code=409,
                detail="Latest prediction has no valid input snapshot.",
            )

        # Copy data while the session is open.
        # The simulator does not modify this prediction.
        source_prediction_id = latest_prediction.id

        source_snapshot = dict(
            latest_prediction.input_snapshot
        )

    # --------------------------------------------------------
    # 3. VALIDATE THE BASELINE INPUT
    # --------------------------------------------------------

    try:
        baseline_request = (
            ProjectDelayPredictionRequest.model_validate(
                {
                    **source_snapshot,
                    "project_db_id": request.project_db_id,
                }
            )
        )

    except ValidationError as exc:
        raise HTTPException(
            status_code=409,
            detail=(
                "The saved baseline snapshot is incompatible "
                f"with the current model schema: {exc}"
            ),
        ) from exc

    baseline_inputs = baseline_request.model_dump(
        exclude={"project_db_id"}
    )

    # --------------------------------------------------------
    # 4. APPLY REQUESTED CHANGES TO A COPY
    # --------------------------------------------------------

    scenario_inputs = {
        **baseline_inputs,
        **request.changes,
    }

    # --------------------------------------------------------
    # 5. VALIDATE THE SCENARIO INPUT
    # --------------------------------------------------------

    try:
        scenario_request = (
            ProjectDelayPredictionRequest.model_validate(
                {
                    **scenario_inputs,
                    "project_db_id": request.project_db_id,
                }
            )
        )

    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid scenario input: {exc}",
        ) from exc

    validated_scenario = scenario_request.model_dump(
        exclude={"project_db_id"}
    )

    # --------------------------------------------------------
    # 6. RUN BOTH INPUTS THROUGH THE SAME CURRENT MODELS
    # --------------------------------------------------------

    baseline_result = predict_project_delay(
        baseline_inputs
    )

    scenario_result = predict_project_delay(
        validated_scenario
    )

    baseline_prediction = baseline_result["prediction"]
    scenario_prediction = scenario_result["prediction"]

    # --------------------------------------------------------
    # 7. CALCULATE COMPARISON
    # --------------------------------------------------------

    baseline_risk = float(
        baseline_prediction["risk_score"]
    )

    scenario_risk = float(
        scenario_prediction["risk_score"]
    )

    baseline_delay = int(
        baseline_prediction["expected_delay_days"]
    )

    scenario_delay = int(
        scenario_prediction["expected_delay_days"]
    )

    comparison = {
        "risk_score_delta": round(
            scenario_risk - baseline_risk,
            2,
        ),
        "expected_delay_days_delta": (
            scenario_delay - baseline_delay
        ),
    }

    # --------------------------------------------------------
    # 8. RETURN RESULTS — NO DATABASE WRITE
    # --------------------------------------------------------

    return {
        "success": True,
        "saved": False,
        "project_db_id": request.project_db_id,
        "source_prediction_id": source_prediction_id,
        "changed_features": request.changes,
        "baseline": {
            "inputs": baseline_inputs,
            "prediction": baseline_prediction,
            "explanation": baseline_result["explanation"],
        },
        "scenario": {
            "inputs": validated_scenario,
            "prediction": scenario_prediction,
            "explanation": scenario_result["explanation"],
        },
        "comparison": comparison,
        "model": scenario_result["model"],
        "note": (
            "Both outputs were recomputed using the current "
            "models. Differences are model sensitivities, "
            "not proven causal intervention effects. "
            "Synthetic-data prototype; no prediction saved."
        ),
    }