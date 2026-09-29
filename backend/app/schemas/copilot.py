from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CopilotConversationMessage(BaseModel):
    role: Literal["user", "assistant"]

    content: str = Field(
        min_length=1,
        max_length=4000,
    )


class CopilotChatRequest(BaseModel):
    question: str = Field(
        min_length=1,
        max_length=2000,
    )

    project_id: int | None = Field(
        default=None,
        ge=1,
    )

    conversation: list[CopilotConversationMessage] = Field(
        default_factory=list,
        max_length=12,
    )


class CopilotChatResponse(BaseModel):
    success: bool = True

    answer: str

    selected_project_id: int | None = None

    tools_used: list[str] = Field(
        default_factory=list,
    )

    grounded: bool = True

    warnings: list[str] = Field(
        default_factory=list,
    )