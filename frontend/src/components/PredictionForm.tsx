import { useEffect, useRef, useState, type FormEvent } from "react";
import "./PredictionForm.css";
import {
  runProjectPrediction,
  type PredictionPayload,
  type RunPredictionResponse,
} from "../services/projectsApi";

type FieldKind = "text" | "number" | "boolean";

type Field = {
  name: string;
  label: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  integer?: boolean;
};

type FieldGroup = {
  title: string;
  fields: Field[];
};

type PredictionFormProps = {
  projectId: number;
  projectName: string;
  snapshot: Record<string, unknown>;
  onPredictionSaved: () => void | Promise<void>;
};

// The 31 feature names must match the FastAPI prediction request exactly.
const FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Project Information",
    fields: [
      { name: "project_type", label: "Project Type", kind: "text" },
      { name: "state", label: "State", kind: "text" },
      { name: "district", label: "District", kind: "text" },
      { name: "implementing_agency", label: "Implementing Agency", kind: "text" },
      { name: "current_stage", label: "Current Stage", kind: "text" },
    ],
  },
  {
    title: "Legal and Dispute Factors",
    fields: [
      { name: "dispute_severity", label: "Dispute Severity", kind: "number", min: 0, integer: true },
      { name: "rehabilitation_required", label: "Rehabilitation Required", kind: "boolean" },
      { name: "legal_dispute", label: "Legal Dispute", kind: "boolean" },
      { name: "stay_order", label: "Stay Order", kind: "boolean" },
      { name: "ownership_conflict", label: "Ownership Conflict", kind: "boolean" },
    ],
  },
  {
    title: "Land and Population",
    fields: [
      { name: "total_land_area", label: "Total Land Area (ha)", kind: "number", min: 0 },
      { name: "number_of_parcels", label: "Number of Parcels", kind: "number", min: 0, integer: true },
      { name: "number_of_landowners", label: "Number of Landowners", kind: "number", min: 0, integer: true },
      { name: "affected_families", label: "Affected Families", kind: "number", min: 0, integer: true },
      { name: "displaced_families", label: "Displaced Families", kind: "number", min: 0, integer: true },
    ],
  },
  {
    title: "Time and Acquisition Progress",
    fields: [
      { name: "days_elapsed", label: "Days Elapsed", kind: "number", min: 0, integer: true },
      { name: "approval_pending_days", label: "Approval Pending Days", kind: "number", min: 0, integer: true },
      { name: "documentation_completion_percentage", label: "Documentation Completion (%)", kind: "number", min: 0, max: 100 },
      { name: "land_acquisition_percentage", label: "Land Acquisition (%)", kind: "number", min: 0, max: 100 },
    ],
  },
  {
    title: "Compensation",
    fields: [
      { name: "compensation_percentage", label: "Compensation Completed (%)", kind: "number", min: 0, max: 100 },
      { name: "compensation_pending_families", label: "Families Awaiting Compensation", kind: "number", min: 0, integer: true },
    ],
  },
  {
    title: "Legal Cases",
    fields: [
      { name: "number_of_cases", label: "Number of Cases", kind: "number", min: 0, integer: true },
    ],
  },
  {
    title: "Rehabilitation and Possession",
    fields: [
      { name: "rehabilitation_percentage", label: "Rehabilitation Progress (%)", kind: "number", min: 0, max: 100 },
      { name: "resettlement_percentage", label: "Resettlement Progress (%)", kind: "number", min: 0, max: 100 },
      { name: "possession_percentage", label: "Possession Progress (%)", kind: "number", min: 0, max: 100 },
    ],
  },
  {
    title: "Stakeholder and Coordination",
    fields: [
      { name: "stakeholder_responsiveness", label: "Stakeholder Responsiveness", kind: "number", min: 0, max: 100 },
      { name: "number_of_pending_responses", label: "Pending Responses", kind: "number", min: 0, integer: true },
      { name: "department_coordination_score", label: "Department Coordination Score", kind: "number", min: 0, max: 100 },
    ],
  },
  {
    title: "Historical Risk Indicators",
    fields: [
      { name: "district_historical_delay_rate", label: "District Historical Delay Rate (0–1)", kind: "number", min: 0, max: 1 },
      { name: "agency_historical_delay_rate", label: "Agency Historical Delay Rate (0–1)", kind: "number", min: 0, max: 1 },
      { name: "similar_project_delay_rate", label: "Similar Project Delay Rate (0–1)", kind: "number", min: 0, max: 1 },
    ],
  },
];

const FEATURE_COUNT = FIELD_GROUPS.reduce(
  (total, group) => total + group.fields.length,
  0,
);

function snapshotToForm(snapshot: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};

  for (const group of FIELD_GROUPS) {
    for (const field of group.fields) {
      const value = snapshot[field.name];

      if (value === null || value === undefined) {
        values[field.name] = "";
      } else if (field.kind === "boolean") {
        const normalized = String(value).toLowerCase();
        values[field.name] =
          normalized === "true" || normalized === "1"
            ? "1"
            : normalized === "false" || normalized === "0"
              ? "0"
              : "";
      } else {
        values[field.name] = String(value);
      }
    }
  }

  return values;
}

// The first nine steps edit model inputs; the final step reviews them.
const REVIEW_STEP = FIELD_GROUPS.length;

function validateGroup(
  group: FieldGroup,
  values: Record<string, string>,
): string | null {
  for (const field of group.fields) {
    const raw = (values[field.name] ?? "").trim();
    if (!raw) return `Please enter ${field.label}.`;

    if (field.kind === "text") continue;

    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return `Enter a valid number for ${field.label}.`;
    }
    if (field.kind === "boolean" && numeric !== 0 && numeric !== 1) {
      return `${field.label} must be Yes or No.`;
    }
    if (field.min !== undefined && numeric < field.min) {
      return `${field.label} must be at least ${field.min}.`;
    }
    if (field.max !== undefined && numeric > field.max) {
      return `${field.label} must not exceed ${field.max}.`;
    }
    if (field.integer && !Number.isInteger(numeric)) {
      return `${field.label} must be a whole number.`;
    }
  }
  return null;
}

export default function PredictionForm({
  projectId,
  projectName,
  snapshot,
  onPredictionSaved,
}: PredictionFormProps) {
  const [values, setValues] = useState<Record<string, string>>(
    () => snapshotToForm(snapshot),
  );
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const [result, setResult] = useState<RunPredictionResponse | null>(null);
  const topRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setValues(snapshotToForm(snapshot));
    setError("");
  }, [snapshot]);

  const completeGroups = FIELD_GROUPS.filter(
    (group) => validateGroup(group, values) === null,
  ).length;

  function jumpTo(next: number): void {
    if (submitting) return;
    setStep(Math.max(0, Math.min(REVIEW_STEP, next)));
    setError("");
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateField(name: string, value: string): void {
    setValues((previous) => ({ ...previous, [name]: value }));
    setError("");
    setResult(null); // Do not show a result for inputs edited after that result was saved.
  }

  function resetForm(): void {
    setValues(snapshotToForm(snapshot));
    setError("");
    setRefreshWarning("");
    setResult(null);
    jumpTo(0);
  }

  function nextStep(): void {
    if (step >= REVIEW_STEP) return;
    const validationError = validateGroup(FIELD_GROUPS[step], values);
    if (validationError) {
      setError(validationError);
      return;
    }
    jumpTo(step + 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    if (step !== REVIEW_STEP) {
      nextStep();
      return;
    }

    // Check ALL features, including earlier groups, before calling FastAPI.
    const firstInvalid = FIELD_GROUPS.findIndex(
      (group) => validateGroup(group, values) !== null,
    );
    if (firstInvalid >= 0) {
      const message = validateGroup(FIELD_GROUPS[firstInvalid], values);
      jumpTo(firstInvalid);
      setError(message ?? "Please correct the marked section.");
      return;
    }

    setSubmitting(true);
    setError("");
    setRefreshWarning("");
    setResult(null);

    try {
      const payload: PredictionPayload = { project_db_id: projectId };
      for (const group of FIELD_GROUPS) {
        for (const field of group.fields) {
          const raw = values[field.name].trim();
          payload[field.name] = field.kind === "text" ? raw : Number(raw);
        }
      }
      const savedPrediction = await runProjectPrediction(payload);
      setResult(savedPrediction);
      try {
        await onPredictionSaved();
      } catch {
        setRefreshWarning(
          "Prediction saved, but the dashboard did not refresh. Click Refresh.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run prediction.");
    } finally {
      setSubmitting(false);
    }
  }

  const activeGroup = step < REVIEW_STEP ? FIELD_GROUPS[step] : null;

  return (
    <section className="prediction-form" ref={topRef}>
      <div className="panel-heading">
        <div>
          <h2>Run New ML Prediction</h2>
          <p>Edit model inputs for {projectName}, one section at a time.</p>
        </div>
        <span className="count-badge">{FEATURE_COUNT} features</span>
      </div>



      <div className="prediction-wizard-heading">
        <div>
          <strong>Step {step + 1} of {REVIEW_STEP + 1}</strong>
          <span>{completeGroups} of {REVIEW_STEP} input sections complete</span>
        </div>
        <progress
          value={completeGroups}
          max={REVIEW_STEP}
          aria-label="Completed prediction input sections"
        />
      </div>

      <nav className="prediction-wizard-steps" aria-label="Prediction form sections">
        {FIELD_GROUPS.map((group, index) => (
          <button
            key={group.title}
            type="button"
            className={`prediction-wizard-step ${step === index ? "is-active" : ""}`}
            aria-current={step === index ? "step" : undefined}
            onClick={() => jumpTo(index)}
            disabled={submitting}
            title={group.title}
          >
            <span>{index + 1}. {group.title}</span>
            <small>{validateGroup(group, values) === null ? "✓ Complete" : "Needs review"}</small>
          </button>
        ))}
        <button
          type="button"
          className={`prediction-wizard-step ${step === REVIEW_STEP ? "is-active" : ""}`}
          aria-current={step === REVIEW_STEP ? "step" : undefined}
          onClick={() => jumpTo(REVIEW_STEP)}
          disabled={submitting}
        >
          <span>{REVIEW_STEP + 1}. Review & Run</span>
          <small>{completeGroups}/{REVIEW_STEP} ready</small>
        </button>
      </nav>

      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        {activeGroup ? (
          <div className="prediction-field-group prediction-wizard-content">
            <div className="prediction-wizard-section-heading">
              <h3>{activeGroup.title}</h3>
              <span>{activeGroup.fields.length} fields</span>
            </div>
            <div className="prediction-fields">
              {activeGroup.fields.map((field) => (
                <label key={field.name} className="prediction-field">
                  <span>{field.label}</span>
                  {field.kind === "boolean" ? (
                    <select
                      value={values[field.name] ?? ""}
                      onChange={(event) => updateField(field.name, event.target.value)}
                      disabled={submitting}
                      required
                    >
                      <option value="">Select an option</option>
                      <option value="0">No</option>
                      <option value="1">Yes</option>
                    </select>
                  ) : (
                    <input
                      type={field.kind}
                      value={values[field.name] ?? ""}
                      onChange={(event) => updateField(field.name, event.target.value)}
                      min={field.min}
                      max={field.max}
                      step={field.kind === "number" ? (field.integer ? 1 : "any") : undefined}
                      disabled={submitting}
                      required
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="prediction-wizard-review">
            <h3>Review before creating a prediction</h3>
            <p>
              {completeGroups === REVIEW_STEP
                ? "All input sections passed the form's basic checks."
                : "Some sections need attention. Select Edit to correct them."}
            </p>
            <div className="prediction-wizard-review-list">
              {FIELD_GROUPS.map((group, index) => {
                const issue = validateGroup(group, values);
                return (
                  <div className="prediction-wizard-review-row" key={group.title}>
                    <div>
                      <strong>{index + 1}. {group.title}</strong>
                      <span>{issue ?? `${group.fields.length} fields complete`}</span>
                    </div>
                    <button type="button" onClick={() => jumpTo(index)} disabled={submitting}>
                      Edit
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="prediction-wizard-warning">
              Run Prediction writes a new saved model output to prediction history.
              It does not verify real-world project conditions.
            </p>
          </div>
        )}

        {error && <div className="error-box" role="alert">{error}</div>}

        <div className="prediction-actions prediction-wizard-actions">
          <button
            type="button"
            className="refresh-button"
            onClick={() => jumpTo(step - 1)}
            disabled={submitting || step === 0}
          >
            ← Previous
          </button>
          {step < REVIEW_STEP ? (
            <button type="button" className="refresh-button" onClick={nextStep} disabled={submitting}>
              {step === REVIEW_STEP - 1 ? "Review inputs →" : "Next section →"}
            </button>
          ) : (
            <button type="submit" className="refresh-button" disabled={submitting}>
              {submitting ? "Running ML Prediction..." : "▶ Run Prediction"}
            </button>
          )}
          <button type="button" className="refresh-button" onClick={resetForm} disabled={submitting}>
            Reset all inputs
          </button>
        </div>
      </form>

      {result && (
        <div className="prediction-result" role="status">
          <h3>Prediction Saved Successfully</h3>
          <div className="detail-metrics">
            <div><span>Risk Score</span><strong>{result.data.prediction.risk_score}/100</strong></div>
            <div><span>Risk Level</span><strong>{result.data.prediction.risk_level}</strong></div>
            <div><span>Delay Probability</span><strong>{result.data.prediction.delay_probability_percent}%</strong></div>
            <div><span>Expected Delay</span><strong>{result.data.prediction.expected_delay_days} days</strong></div>
          </div>
          <p>Saved prediction ID: <strong>{result.prediction_id}</strong></p>
          {refreshWarning && <div className="error-box" role="alert">{refreshWarning}</div>}
        </div>
      )}
    </section>
  );
}
