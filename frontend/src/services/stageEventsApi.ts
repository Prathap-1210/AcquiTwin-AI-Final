const API_BASE_URL = "http://127.0.0.1:8000";

export type StageStatus =
  | "planned"
  | "in_progress"
  | "on_hold"
  | "completed";

export interface StageEvent {
  id: number;
  project_id: number;
  stage_name: string;
  stage_status: StageStatus;
  progress_percentage: number;
  actual_start_date: string | null;
  planned_end_date: string | null;
  actual_completion_date: string | null;
  notes: string | null;
  recorded_at: string;
  source: string;
}

export interface StageEventPayload {
  stage_name: string;
  stage_status: StageStatus;
  progress_percentage: number;
  actual_start_date: string | null;
  planned_end_date: string | null;
  actual_completion_date: string | null;
  notes: string | null;
}

export interface StageEventsResponse {
  success: boolean;
  project_db_id: number;
  total_events: number;
  events: StageEvent[];
  note: string;
}

export interface CreateStageEventResponse {
  success: boolean;
  saved: boolean;
  event: StageEvent;
}

async function parseResponse<T>(
  response: Response
): Promise<T> {
  const data: unknown = await response.json();

  if (!response.ok) {
    if (
      data &&
      typeof data === "object" &&
      "detail" in data
    ) {
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail)
      );
    }

    throw new Error(
      `Stage Events API error: HTTP ${response.status}`
    );
  }

  return data as T;
}

export async function getStageEvents(
  projectId: number
): Promise<StageEventsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/stage-events/projects/${projectId}`
  );

  return parseResponse<StageEventsResponse>(response);
}

export async function createStageEvent(
  projectId: number,
  payload: StageEventPayload
): Promise<CreateStageEventResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/stage-events/projects/${projectId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  return parseResponse<CreateStageEventResponse>(
    response
  );
}