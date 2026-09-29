from fastapi import APIRouter, HTTPException

from app.schemas.prediction import (
    ProjectDelayPredictionRequest,
)

from app.services.prediction_service import (
    predict_project_delay,
)

from app.services.prediction_persistence import (
    save_prediction_result,
)


router = APIRouter(
    prefix="/api/v1/predictions",
    tags=["Predictions"],
)


@router.post("/project-delay")
def project_delay_prediction(
    request: ProjectDelayPredictionRequest,
):
    try:
        # ====================================================
        # REQUEST → DICTIONARY
        # ====================================================

        payload = request.model_dump()

        # This field belongs to the DB layer,
        # not the ML model.
        project_db_id = payload.pop(
            "project_db_id",
            None,
        )

        # ====================================================
        # ML PREDICTION
        # ====================================================

        result = predict_project_delay(
            payload
        )

        prediction_id = None

        # ====================================================
        # OPTIONAL DATABASE PERSISTENCE
        # ====================================================

        if project_db_id is not None:

            prediction_id = save_prediction_result(
                project_db_id=project_db_id,
                input_payload=payload,
                result=result,
            )

        # ====================================================
        # RESPONSE
        # ====================================================

        return {
            "success": True,

            "saved": (
                prediction_id is not None
            ),

            "prediction_id": prediction_id,

            "project_db_id": project_db_id,

            "data": result,
        }

    except ValueError as exc:

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    except FileNotFoundError as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=(
                f"Prediction failed: {exc}"
            ),
        )