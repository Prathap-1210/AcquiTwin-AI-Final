from fastapi import APIRouter
from sqlalchemy import select

from app.database.session import SessionLocal
from app.model.prediction import Prediction
from app.model.risk_factor import RiskFactor


router = APIRouter(
    prefix="/api/v1/predictions",
    tags=["Prediction History"],
)


@router.get("/projects/{project_id}/history")
def get_prediction_history(project_id: int):

    db = SessionLocal()

    try:

        predictions = db.scalars(
            select(Prediction)
            .where(Prediction.project_id == project_id)
            .order_by(Prediction.id.desc())
        ).all()

        history = []

        for prediction in predictions:

            factors = db.scalars(
                select(RiskFactor)
                .where(
                    RiskFactor.prediction_id == prediction.id
                )
                .order_by(RiskFactor.importance_rank)
            ).all()

            history.append({

                "prediction_id": prediction.id,

                "project_id": prediction.project_id,

                "model_version": prediction.model_version,

                "delay_probability": prediction.delay_probability,

                "risk_score": prediction.risk_score,

                "risk_level": prediction.risk_level,

                "predicted_delay_days": prediction.predicted_delay_days,

                "created_at": (
                    prediction.created_at.isoformat()
                    if prediction.created_at
                    else None
                ),

                # NEW: Original input values used by the model.
                "input_snapshot": prediction.input_snapshot,

                "risk_factors": [
                    {
                        "feature": factor.feature_name,
                        "value": factor.feature_value,
                        "contribution": factor.contribution,
                        "rank": factor.importance_rank,
                        "direction": factor.direction,
                    }
                    for factor in factors
                ],
            })

        return {
            "success": True,
            "project_id": project_id,
            "total_predictions": len(history),
            "history": history,
        }

    finally:
        db.close()