from fastapi import APIRouter, HTTPException

from app.schemas.stage_delay import StageDelayRequest
from app.services.stage_delay_service import (
    predict_stage_delay,
)


router = APIRouter(
    prefix="/api/v1/stage-delay",
    tags=["Stage Delay"],
)


@router.post("/predict")
def predict_stage(request: StageDelayRequest):
    try:
        prediction = predict_stage_delay(request)

    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    return {
        "success": True,
        "saved": False,
        "prediction": prediction,
        "model": {
            "name": "Stage Delay Classifier",
            "algorithm": "LogisticRegression",
            "training_data": "synthetic",
        },
        "note": (
            "Prototype classification only. "
            "Probabilities have not been calibrated or "
            "validated on real-world projects. "
            "No remaining-duration prediction is provided."
        ),
    }