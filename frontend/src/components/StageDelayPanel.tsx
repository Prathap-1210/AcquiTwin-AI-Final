import { useState, type FormEvent } from "react";

import {
  runStageDelayPrediction,
  type StageDelayPayload,
  type StageDelayResponse,
} from "../services/stageDelayApi";

// ============================================================
// PROPS
// ============================================================

interface StageDelayPanelProps {
  projectName: string;
}

// ============================================================
// INPUT TYPES
// ============================================================

type NumericField =
  | "stage_index"
  | "paf_count"
  | "area"
  | "open_litigations"
  | "resolved_litigations"
  | "compensation_pct"
  | "rehabilitation_progress_pct"
  | "days_in_current_stage"
  | "prior_stage_avg_days";

type FormField = NumericField | "current_stage" | "state";

type FormValues = Record<FormField, string>;

interface NumericFieldConfig {
  key: NumericField;
  label: string;
  integer?: boolean;
  max?: number;
}

// ============================================================
// EMPTY FORM — NO PLACEHOLDER PROJECT DATA
// ============================================================

const INITIAL_VALUES: FormValues = {
  current_stage: "",
  state: "",
  stage_index: "",
  paf_count: "",
  area: "",
  open_litigations: "",
  resolved_litigations: "",
  compensation_pct: "",
  rehabilitation_progress_pct: "",
  days_in_current_stage: "",
  prior_stage_avg_days: "",
};

// ============================================================
// NUMERIC FIELDS
// ============================================================

const NUMERIC_FIELDS: NumericFieldConfig[] = [
  {
    key: "stage_index",
    label: "Stage Index",
    integer: true,
  },
  {
    key: "paf_count",
    label: "Project-Affected Families",
    integer: true,
  },
  {
    key: "area",
    label: "Land Area",
  },
  {
    key: "open_litigations",
    label: "Open Litigations",
    integer: true,
  },
  {
    key: "resolved_litigations",
    label: "Resolved Litigations",
    integer: true,
  },
  {
    key: "compensation_pct",
    label: "Compensation Completion (%)",
    max: 100,
  },
  {
    key: "rehabilitation_progress_pct",
    label: "Rehabilitation Progress (%)",
    max: 100,
  },
  {
    key: "days_in_current_stage",
    label: "Days in Current Stage",
    integer: true,
  },
  {
    key: "prior_stage_avg_days",
    label: "Prior Stage Average Duration (Days)",
  },
];

// ============================================================
// FORMAT NUMBERS
// ============================================================

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return value.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

// ============================================================
// VALIDATE AND BUILD API PAYLOAD
// ============================================================

function buildPayload(values: FormValues): StageDelayPayload {
  const currentStage = values.current_stage.trim();
  const state = values.state.trim();

  if (!currentStage) {
    throw new Error("Current Stage is required.");
  }

  if (!state) {
    throw new Error("State is required.");
  }

  const numbers = {} as Record<NumericField, number>;

  for (const field of NUMERIC_FIELDS) {
    const raw = values[field.key].trim();

    if (raw === "") {
      throw new Error(`${field.label} is required.`);
    }

    const value = Number(raw);

    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `${field.label} must be a valid non-negative number.`
      );
    }

    if (field.integer && !Number.isInteger(value)) {
      throw new Error(
        `${field.label} must be a whole number.`
      );
    }

    if (field.max !== undefined && value > field.max) {
      throw new Error(
        `${field.label} cannot exceed ${field.max}.`
      );
    }

    numbers[field.key] = value;
  }

  return {
    current_stage: currentStage,
    state,

    stage_index: numbers.stage_index,
    paf_count: numbers.paf_count,
    area: numbers.area,

    open_litigations: numbers.open_litigations,
    resolved_litigations: numbers.resolved_litigations,

    compensation_pct: numbers.compensation_pct,

    rehabilitation_progress_pct:
      numbers.rehabilitation_progress_pct,

    days_in_current_stage:
      numbers.days_in_current_stage,

    prior_stage_avg_days:
      numbers.prior_stage_avg_days,
  };
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function StageDelayPanel({
  projectName,
}: StageDelayPanelProps) {
  const [values, setValues] = useState<FormValues>(
    INITIAL_VALUES
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [result, setResult] =
    useState<StageDelayResponse | null>(null);

  // ----------------------------------------------------------
  // UPDATE FORM VALUES
  // ----------------------------------------------------------

  function updateField(
    field: FormField,
    value: string
  ): void {
    setValues((previous) => ({
      ...previous,
      [field]: value,
    }));

    // Previous results no longer represent the edited inputs.
    setResult(null);
    setError("");
  }

  // ----------------------------------------------------------
  // RUN PREDICTION
  // ----------------------------------------------------------

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();

    if (loading) {
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const payload = buildPayload(values);

      const response = await runStageDelayPrediction(
        payload
      );

      setResult(response);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to run Stage-Delay Model 2."
      );
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="stage-delay-panel">
      {/* HEADER */}

      <div className="panel-heading">
        <div>
          <h2>Stage Intelligence</h2>

          <p>
            Stage-Delay Model 2 — {projectName}
          </p>
        </div>

        <span className="count-badge">
          Model 2
        </span>
      </div>

      {/* NOTICE */}

      <div className="stage-delay-notice">
        Enter the 11 stage-level features below.
        Inputs are not automatically copied from the
        project-delay model because the two models
        use different feature definitions.
      </div>

      {/* FORM */}

      <form
        className="stage-delay-form"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="stage-delay-grid">
          {/* CURRENT STAGE */}

          <label className="stage-delay-field">
            <span>Current Stage</span>

            <input
              type="text"
              value={values.current_stage}
              placeholder="Example: 3D"
              disabled={loading}
              required
              onChange={(event) =>
                updateField(
                  "current_stage",
                  event.target.value
                )
              }
            />
          </label>

          {/* STATE */}

          <label className="stage-delay-field">
            <span>State</span>

            <input
              type="text"
              value={values.state}
              placeholder="Example: Karnataka"
              disabled={loading}
              required
              onChange={(event) =>
                updateField(
                  "state",
                  event.target.value
                )
              }
            />
          </label>

          {/* ALL NINE NUMERIC FIELDS */}

          {NUMERIC_FIELDS.map((field) => (
            <label
              className="stage-delay-field"
              key={field.key}
            >
              <span>{field.label}</span>

              <input
                type="number"
                min={0}
                max={field.max}
                step={field.integer ? 1 : "any"}
                value={values[field.key]}
                disabled={loading}
                required
                onChange={(event) =>
                  updateField(
                    field.key,
                    event.target.value
                  )
                }
              />
            </label>
          ))}
        </div>

        {/* SUBMIT */}

        <div className="stage-delay-actions">
          <button
            type="submit"
            className="refresh-button"
            disabled={loading}
          >
            {loading
              ? "Running Model 2..."
              : "Run Stage-Delay Prediction"}
          </button>
        </div>
      </form>

      {/* ERROR */}

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {/* RESULTS */}

      {result && (
        <div className="stage-delay-result">
          <div className="stage-delay-result-heading">
            <h3>Stage-Delay Prediction Result</h3>

            <span className="count-badge">
              Complete
            </span>
          </div>

          <div className="stage-delay-result-grid">
            {/* PROBABILITY */}

            <div className="stage-delay-metric">
              <span>
                Stage-Delay Probability
              </span>

              <strong>
                {formatNumber(
                  result.prediction
                    .stage_delay_probability_percent
                )}
                %
              </strong>

              <small>
                Uncalibrated model probability
              </small>
            </div>

            {/* PREDICTED CLASS */}

            <div className="stage-delay-metric">
              <span>Predicted Delay Class</span>

              <strong>
                {
                  result.prediction
                    .predicted_delay_label
                }
              </strong>

              <small>
                {result.prediction.predicted_delay_label === 1
                  ? "Positive delay class"
                  : "Negative delay class"}
              </small>
            </div>
          </div>

          {/* PROBABILITY BAR */}

          <div className="stage-delay-probability">
            <div className="stage-delay-probability-header">
              <span>
                Model Probability
              </span>

              <strong>
                {formatNumber(
                  result.prediction
                    .stage_delay_probability_percent
                )}
                %
              </strong>
            </div>

            <div className="stage-delay-track">
              <div
                className="stage-delay-fill"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      result.prediction
                        .stage_delay_probability_percent
                    )
                  )}%`,
                }}
              />
            </div>
          </div>

          {/* MODEL INFORMATION */}

          <div className="stage-delay-meta">
            <span>
              Algorithm: {result.model.algorithm}
            </span>

            <span>
              Threshold:{" "}
              {formatNumber(
                result.prediction.classification_threshold
              )}
            </span>

            <span>
              Saved: {result.saved ? "Yes" : "No"}
            </span>
          </div>

          {/* LIMITATIONS */}

          <div className="stage-delay-notice">
            {result.note}
          </div>
        </div>
      )}
    </div>
  );
}