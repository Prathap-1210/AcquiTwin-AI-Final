import { useState } from "react";
import type { HistoryEntry } from "../services/projectsApi";
import {
  downloadPredictionComparisonReportPdf,
  type PredictionComparisonInputChange,
} from "../utils/predictionComparisonReportPdf";

interface Props {
  projectName: string;
  history: HistoryEntry[];
  totalPredictions: number;
}

type ChangeType = "Numerical" | "Categorical" | "Added" | "Removed";

interface InputChange {
  feature: string;
  previous: unknown;
  latest: unknown;
  category: ChangeType;
  difference: number | null;
}

function printable(value: unknown): string {
  if (value === undefined) return "Not present";
  if (value === null) return "null";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "Invalid number";
  }
  if (typeof value === "string") return value || "(empty string)";
  return JSON.stringify(value) ?? "Unavailable";
}

function formatted(value: number, digits = 2): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function signed(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${formatted(value, digits)}`;
}

function stamp(value: string | null): string {
  return value?.replace("T", " ").slice(0, 19) ?? "Unavailable";
}

function isSnapshot(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareInputs(
  earlier: Record<string, unknown>,
  later: Record<string, unknown>,
): InputChange[] {
  const changes: InputChange[] = [];

  for (const feature of new Set([...Object.keys(earlier), ...Object.keys(later)])) {
    const beforeExists = Object.prototype.hasOwnProperty.call(earlier, feature);
    const afterExists = Object.prototype.hasOwnProperty.call(later, feature);
    const previous = earlier[feature];
    const latest = later[feature];

    if (!beforeExists || !afterExists) {
      changes.push({
        feature,
        previous,
        latest,
        category: beforeExists ? "Removed" : "Added",
        difference: null,
      });
      continue;
    }

    if (
      typeof previous === "number" &&
      typeof latest === "number" &&
      Number.isFinite(previous) &&
      Number.isFinite(latest)
    ) {
      if (previous !== latest) {
        changes.push({
          feature,
          previous,
          latest,
          category: "Numerical",
          difference: latest - previous,
        });
      }
    } else if (JSON.stringify(previous) !== JSON.stringify(latest)) {
      changes.push({
        feature,
        previous,
        latest,
        category: "Categorical",
        difference: null,
      });
    }
  }

  return changes.sort((a, b) => a.feature.localeCompare(b.feature));
}

export default function PredictionComparisonPanel({
  projectName,
  history,
  totalPredictions,
}: Props) {
  const [firstId, setFirstId] = useState<number | null>(null);
  const [secondId, setSecondId] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState("");
  const [pdfMessage, setPdfMessage] = useState("");
  const [working, setWorking] = useState(false);

  const ordered = [...history].sort((a, b) => b.prediction_id - a.prediction_id);
  const a = ordered.find((entry) => entry.prediction_id === firstId) ?? ordered[0] ?? null;
  const b = ordered.find((entry) => entry.prediction_id === secondId) ?? ordered[1] ?? null;

  if (!a || !b) {
    return (
      <div className="prediction-comparison-panel">
        <div className="panel-heading">
          <div>
            <h2>Prediction Comparison</h2>
            <p>{projectName}</p>
          </div>
        </div>
        <p className="empty-state">
          At least two saved predictions are required to compare or export.
        </p>
      </div>
    );
  }

  const sameSelection = a.prediction_id === b.prediction_id;
  const earlier = a.prediction_id < b.prediction_id ? a : b;
  const later = a.prediction_id > b.prediction_id ? a : b;
  const sameModel = earlier.model_version === later.model_version;

  const validOutputs = [
    earlier.risk_score,
    later.risk_score,
    earlier.delay_probability,
    later.delay_probability,
    earlier.predicted_delay_days,
    later.predicted_delay_days,
  ].every((value) => typeof value === "number" && Number.isFinite(value));

  const earlierSnapshot = earlier.input_snapshot;
  const laterSnapshot = later.input_snapshot;
  const snapshotsAvailable = isSnapshot(earlierSnapshot) && isSnapshot(laterSnapshot);

  const changes =
    !sameSelection && isSnapshot(earlierSnapshot) && isSnapshot(laterSnapshot)
      ? compareInputs(earlierSnapshot, laterSnapshot)
      : [];

  const differences =
    !sameSelection && sameModel && validOutputs
      ? {
          riskScore: later.risk_score - earlier.risk_score,
          probability: (later.delay_probability - earlier.delay_probability) * 100,
          delayDays: later.predicted_delay_days - earlier.predicted_delay_days,
        }
      : null;

  async function downloadPdf(): Promise<void> {
    if (sameSelection || working) return;

    setWorking(true);
    setPdfError("");
    setPdfMessage("");

    try {
      await downloadPredictionComparisonReportPdf({
        projectName,
        earlier: {
          predictionId: earlier.prediction_id,
          timestamp: earlier.created_at,
          modelVersion: earlier.model_version,
          riskScore: earlier.risk_score,
          riskLevel: earlier.risk_level,
          delayProbability: earlier.delay_probability,
          predictedDelayDays: earlier.predicted_delay_days,
        },
        later: {
          predictionId: later.prediction_id,
          timestamp: later.created_at,
          modelVersion: later.model_version,
          riskScore: later.risk_score,
          riskLevel: later.risk_level,
          delayProbability: later.delay_probability,
          predictedDelayDays: later.predicted_delay_days,
        },
        outputDifferences: differences,
        inputChanges: changes as PredictionComparisonInputChange[],
        snapshotsAvailable,
        sameModel,
        validOutputs,
        recordsRetrieved: history.length,
        apiReportedTotal: totalPredictions,
      });

      setPdfMessage("PDF generated. Check your browser's Downloads list.");
    } catch (caught) {
      setPdfError(caught instanceof Error ? caught.message : "PDF generation failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="prediction-comparison-panel">
      <div className="panel-heading">
        <div>
          <h2>Prediction Comparison</h2>
          <p>Choose two saved predictions for {projectName}.</p>
        </div>
        <span className="count-badge">{ordered.length} records</span>
      </div>

      <div className="stage-intelligence-notice">
        Model predictions are prototype decision-support outputs, not observed outcomes.
        Comparisons do not establish intervention effectiveness.
      </div>

      <div className="project-filter-grid" role="group" aria-label="Choose predictions">
        <label>
          Prediction A
          <select
            value={a.prediction_id}
            onChange={(event) => setFirstId(Number(event.target.value))}
          >
            {ordered.map((entry) => (
              <option
                key={entry.prediction_id}
                value={entry.prediction_id}
                disabled={entry.prediction_id === b.prediction_id}
              >
                #{entry.prediction_id} - {stamp(entry.created_at)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Prediction B
          <select
            value={b.prediction_id}
            onChange={(event) => setSecondId(Number(event.target.value))}
          >
            {ordered.map((entry) => (
              <option
                key={entry.prediction_id}
                value={entry.prediction_id}
                disabled={entry.prediction_id === a.prediction_id}
              >
                #{entry.prediction_id} - {stamp(entry.created_at)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        className="refresh-button"
        onClick={() => void downloadPdf()}
        disabled={sameSelection || working}
      >
        {working ? "Generating PDF..." : "Download Comparison Report (PDF)"}
      </button>

      {pdfError && (
        <div className="error-box" role="alert">
          PDF export failed: {pdfError}
        </div>
      )}

      {pdfMessage && (
        <p className="explanation-note" role="status">
          {pdfMessage}
        </p>
      )}

      {totalPredictions > history.length && (
        <p className="explanation-note">
          Only {history.length} of {totalPredictions} reported records were retrieved;
          unavailable records cannot be selected.
        </p>
      )}

      {sameSelection ? (
        <div className="error-box" role="alert">
          Choose two different predictions.
        </div>
      ) : (
        <>
          <h3>
            Earlier #{earlier.prediction_id} vs later #{later.prediction_id}
          </h3>

          <div className="history-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Earlier</th>
                  <th>Later</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Prediction ID</td>
                  <td>#{earlier.prediction_id}</td>
                  <td>#{later.prediction_id}</td>
                </tr>
                <tr>
                  <td>Saved timestamp (API)</td>
                  <td>{stamp(earlier.created_at)}</td>
                  <td>{stamp(later.created_at)}</td>
                </tr>
                <tr>
                  <td>Model version</td>
                  <td>{earlier.model_version}</td>
                  <td>{later.model_version}</td>
                </tr>
                <tr>
                  <td>Risk score</td>
                  <td>{printable(earlier.risk_score)}/100</td>
                  <td>{printable(later.risk_score)}/100</td>
                </tr>
                <tr>
                  <td>Risk level</td>
                  <td>{earlier.risk_level}</td>
                  <td>{later.risk_level}</td>
                </tr>
                <tr>
                  <td>Delay probability</td>
                  <td>{formatted(earlier.delay_probability * 100)}%</td>
                  <td>{formatted(later.delay_probability * 100)}%</td>
                </tr>
                <tr>
                  <td>Predicted delay</td>
                  <td>{printable(earlier.predicted_delay_days)} days</td>
                  <td>{printable(later.predicted_delay_days)} days</td>
                </tr>
              </tbody>
            </table>
          </div>

          {!sameModel ? (
            <p className="explanation-note">
              Model versions differ. Numerical output differences are omitted.
            </p>
          ) : !validOutputs ? (
            <p className="explanation-note">
              Invalid output values; numerical differences are omitted.
            </p>
          ) : (
            differences && (
              <>
                <h3>Model output differences</h3>
                <div className="detail-metrics">
                  <div>
                    <span>Risk score change</span>
                    <strong>{signed(differences.riskScore)} points</strong>
                  </div>
                  <div>
                    <span>Delay probability change</span>
                    <strong>{signed(differences.probability)} percentage points</strong>
                  </div>
                  <div>
                    <span>Predicted delay change</span>
                    <strong>{signed(differences.delayDays)} days</strong>
                  </div>
                </div>
              </>
            )
          )}

          <h3>Changed input features</h3>

          {!snapshotsAvailable ? (
            <p className="empty-state">
              Both input snapshots are needed to compare inputs.
            </p>
          ) : changes.length === 0 ? (
            <p className="empty-state">No input changes detected.</p>
          ) : (
            <div className="history-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Type</th>
                    <th>Earlier</th>
                    <th>Later</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((change) => (
                    <tr key={change.feature}>
                      <td>{change.feature.replace(/_/g, " ")}</td>
                      <td>{change.category}</td>
                      <td>{printable(change.previous)}</td>
                      <td>{printable(change.latest)}</td>
                      <td>
                        {change.difference === null
                          ? "-"
                          : signed(change.difference, 4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="explanation-note">
            Input differences are descriptive only. ID order does not independently
            verify event chronology.
          </p>
        </>
      )}
    </div>
  );
}
