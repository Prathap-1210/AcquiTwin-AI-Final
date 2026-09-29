from fastapi import APIRouter, HTTPException

from app.innovations.copilot.service import (
    CopilotConfigurationError,
    CopilotProviderError,
    chat_with_copilot,
)

from app.schemas.copilot import (
    CopilotChatRequest,
    CopilotChatResponse,
)


router = APIRouter(
    prefix="/api/v1/copilot",
    tags=["AcquiTwin Copilot"],
)


@router.post(
    "/chat",
    response_model=CopilotChatResponse,
)
def copilot_chat(
    request: CopilotChatRequest,
) -> CopilotChatResponse:

    try:
        return chat_with_copilot(request)

    except CopilotConfigurationError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    except CopilotProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Copilot request failed: {exc}",
        ) from exc