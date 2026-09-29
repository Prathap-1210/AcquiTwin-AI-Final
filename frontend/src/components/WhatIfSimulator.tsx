import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import {
  runWhatIfSimulation,
  type WhatIfResponse,
} from "../services/projectsApi";

// ============================================================
// TYPES
// ============================================================

type FeatureName =
  | "approval_pending_days"
  | "compensation_percentage"
  | "legal_dispute"
  | "number_of_cases"
  | "possession_percentage"
  | "documentation_completion_percentage";

interface SimulatorField {
  name: FeatureName;
  label: string;
  min: number;
  max?: number;
  integer?: boolean;
  boolean?: boolean;
}

interface WhatIfSimulatorProps {
  projectId: number;
  projectName: string;
  sourcePredictionId: number;
  snapshot: Record<string, unknown>;
}

// ============================================================
// EDITABLE SIMULATION FEATURES
// ============================================================

const FIELDS: SimulatorField[] = [
  {
    name: "approval_pending_days",
    label: "Approval Pending Days",
    min: 0,
    integer: true,
  },
  {
    name: "compensation_percentage",
    label: "Compensation Completed (%)",
    min: 0,
    max: 100,
  },
  {
    name: "legal_dispute",
    label: "Legal Dispute",
    min: 0,
    max: 1,
    boolean: true,
  },
  {
    name: "number_of_cases",
    label: "Number of Legal Cases",
    min: 0,
    integer: true,
  },
  {
    name: "possession_percentage",
    label: "Possession Progress (%)",
    min: 0,
    max: 100,
  },
  {
    name: "documentation_completion_percentage",
    label: "Documentation Completion (%)",
    min: 0,
    max: 100,
  },
];

// ============================================================
// HELPERS
// ============================================================

function snapshotValue(value: unknown): string {
  if (value === true) return "1";
  if (value === false) return "0";

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function makeInitialValues(
  snapshot: Record<string, unknown>
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const field of FIELDS) {
    values[field.name] = snapshotValue(
      snapshot[field.name]
    );
  }

  return values;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

function formatDelta(value: number): string {
  const prefix = value > 0 ? "+" : "";

  return `${prefix}${formatNumber(value)}`;
}

// ============================================================
// COMPONENT
// ============================================================

export default function WhatIfSimulator({
  projectId,
  projectName,
  sourcePredictionId,
  snapshot,
}: WhatIfSimulatorProps) {
  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------

  const [values, setValues] = useState<
    Record<string, string>
  >(() => makeInitialValues(snapshot));

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [result, setResult] = useState<
    WhatIfResponse | null
  >(null);

  // ----------------------------------------------------------
  // RESET WHEN BASELINE CHANGES
  // ----------------------------------------------------------

  useEffect(() => {
    setValues(makeInitialValues(snapshot));
    setResult(null);
    setError("");
  }, [snapshot, sourcePredictionId, projectId]);

  // ----------------------------------------------------------
  // UPDATE FIELD
  // ----------------------------------------------------------

  function updateField(
    name: string,
    value: string
  ) {
    setValues((previous) => ({
      ...previous,
      [name]: value,
    }));

    // Previous results no longer describe the edited inputs.
    setResult(null);
    setError("");
  }

  // ----------------------------------------------------------
  // RESET INPUTS
  // ----------------------------------------------------------

  function resetInputs() {
    setValues(makeInitialValues(snapshot));
    setResult(null);
    setError("");
  }

  // ----------------------------------------------------------
  // RUN SIMULATION
  // ----------------------------------------------------------

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (loading) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const changes: Record<string, number> = {};

      for (const field of FIELDS) {
        const raw = (values[field.name] ?? "").trim();

        if (raw === "") {
          throw new Error(
            `Please enter ${field.label}.`
          );
        }

        const scenarioValue = Number(raw);

        if (!Number.isFinite(scenarioValue)) {
          throw new Error(
            `Invalid value for ${field.label}.`
          );
        }

        if (scenarioValue < field.min) {
          throw new Error(
            `${field.label} cannot be below ${field.min}.`
          );
        }

        if (
          field.max !== undefined &&
          scenarioValue > field.max
        ) {
          throw new Error(
            `${field.label} cannot exceed ${field.max}.`
          );
        }

        if (
          field.integer &&
          !Number.isInteger(scenarioValue)
        ) {
          throw new Error(
            `${field.label} must be a whole number.`
          );
        }

        if (
          field.boolean &&
          scenarioValue !== 0 &&
          scenarioValue !== 1
        ) {
          throw new Error(
            `${field.label} must be Yes or No.`
          );
        }

        const baselineRaw = snapshotValue(
          snapshot[field.name]
        );

        if (baselineRaw === "") {
          throw new Error(
            `Baseline value missing: ${field.label}.`
          );
        }

        const baselineValue = Number(baselineRaw);

        if (!Number.isFinite(baselineValue)) {
          throw new Error(
            `Invalid baseline value: ${field.label}.`
          );
        }

        // Submit only values that differ from the baseline.
        if (scenarioValue !== baselineValue) {
          changes[field.name] = scenarioValue;
        }
      }

      if (Object.keys(changes).length === 0) {
        throw new Error(
          "Change at least one input before running a simulation."
        );
      }

      const response = await runWhatIfSimulation(
        projectId,
        changes
      );

      setResult(response);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The simulation could not be completed."
      );
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // JSX
  // ============================================================

  return (
    <div className="what-if-simulator">
      {/* HEADER */}

      <div className="panel-heading">
        <div>
          <h2>What-If Simulator</h2>

          <p>
            Compare hypothetical conditions for {projectName}.
          </p>
        </div>

        <span className="count-badge">
          Simulation
        </span>
      </div>

      {/* BASELINE INFORMATION */}



      {/* INPUT FORM */}

      <form onSubmit={handleSubmit}>
        <div className="prediction-fields">
          {FIELDS.map((field) => (
            <label
              key={field.name}
              className="prediction-field"
            >
              <span>{field.label}</span>

              {field.boolean ? (
                <select
                  value={values[field.name] ?? ""}
                  onChange={(event) =>
                    updateField(
                      field.name,
                      event.target.value
                    )
                  }
                  disabled={loading}
                  required
                >
                  <option value="">Select</option>
                  <option value="0">No</option>
                  <option value="1">Yes</option>
                </select>
              ) : (
                <input
                  type="number"
                  value={values[field.name] ?? ""}
                  onChange={(event) =>
                    updateField(
                      field.name,
                      event.target.value
                    )
                  }
                  min={field.min}
                  max={field.max}
                  step={field.integer ? 1 : "any"}
                  disabled={loading}
                  required
                />
              )}
            </label>
          ))}
        </div>

        {/* ACTIONS */}

        <div className="prediction-actions">
          <button
            className="refresh-button"
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Running Simulation..."
              : "◈ Compare Scenarios"}
          </button>

          <button
            className="refresh-button"
            type="button"
            onClick={resetInputs}
            disabled={loading}
          >
            Reset Scenario
          </button>
        </div>
      </form>

      {/* ERRORS */}

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {/* COMPARISON RESULTS */}

      {result && (
        <div className="simulation-results">
          <h3>Simulation Comparison</h3>

          <div className="simulation-comparison">
            {/* BASELINE */}

            <div className="simulation-result-card">
              <span className="simulation-card-label">
                BASELINE
              </span>

              <h4>Original inputs</h4>

              <div>
                <span>Risk Score</span>

                <strong>
                  {formatNumber(
                    result.baseline.prediction.risk_score
                  )}
                  /100
                </strong>
              </div>

              <div>
                <span>Delay Probability</span>

                <strong>
                  {formatNumber(
                    result.baseline.prediction
                      .delay_probability * 100
                  )}
                  %
                </strong>
              </div>

              <div>
                <span>Expected Delay</span>

                <strong>
                  {formatNumber(
                    result.baseline.prediction
                      .expected_delay_days
                  )}{" "}
                  days
                </strong>
              </div>

              <div>
                <span>Risk Level</span>

                <strong>
                  {result.baseline.prediction.risk_level}
                </strong>
              </div>
            </div>

            {/* SCENARIO */}

            <div className="simulation-result-card">
              <span className="simulation-card-label">
                SCENARIO
              </span>

              <h4>Edited inputs</h4>

              <div>
                <span>Risk Score</span>

                <strong>
                  {formatNumber(
                    result.scenario.prediction.risk_score
                  )}
                  /100
                </strong>
              </div>

              <div>
                <span>Delay Probability</span>

                <strong>
                  {formatNumber(
                    result.scenario.prediction
                      .delay_probability * 100
                  )}
                  %
                </strong>
              </div>

              <div>
                <span>Expected Delay</span>

                <strong>
                  {formatNumber(
                    result.scenario.prediction
                      .expected_delay_days
                  )}{" "}
                  days
                </strong>
              </div>

              <div>
                <span>Risk Level</span>

                <strong>
                  {result.scenario.prediction.risk_level}
                </strong>
              </div>
            </div>
          </div>

          {/* MODEL OUTPUT DIFFERENCES */}

          <div className="simulation-deltas">
            <div>
              <span>Risk score change</span>

              <strong>
                {formatDelta(
                  result.comparison.risk_score_delta
                )}{" "}
                points
              </strong>
            </div>

            <div>
              <span>Expected delay change</span>

              <strong>
                {formatDelta(
                  result.comparison
                    .expected_delay_days_delta
                )}{" "}
                days
              </strong>
            </div>
          </div>

          <div className="simulation-notice">
            {result.note}
          </div>

          <div className="simulation-unsaved">
            ✓ Simulation only — no prediction record saved.
          </div>
        </div>
      )}
    </div>
  );
}
