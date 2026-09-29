const API_BASE_URL = "http://127.0.0.1:8000";

export interface StageDelayPayload {
  current_stage: string;
  stage_index: number;
  state: string;
  paf_count: number;
  area: number;
  open_litigations: number;
  resolved_litigations: number;
  compensation_pct: number;
  rehabilitation_progress_pct: number;
  days_in_current_stage: number;
  prior_stage_avg_days: number;
}

export interface StageDelayPrediction {
  stage_delay_probability: number;
  stage_delay_probability_percent: number;
  predicted_delay_label: number;
  classification_threshold: number;
}

export interface StageDelayResponse {
  success: boolean;
  saved: boolean;
  prediction: StageDelayPrediction;
  model: {
    name: string;
    algorithm: string;
    training_data: string;
  };
  note: string;
}

export async function runStageDelayPrediction(
  payload: StageDelayPayload
): Promise<StageDelayResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/stage-delay/predict`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Stage-delay API error (${response.status}): ${errorText}`
    );
  }

  const result: StageDelayResponse = await response.json();

  if (
    result.success !== true ||
    result.saved !== false ||
    !result.prediction
  ) {
    throw new Error("Invalid Stage-Delay API response.");
  }

  return result;
}