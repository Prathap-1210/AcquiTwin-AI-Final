import type { HistoryEntry } from "../services/projectsApi";

interface Props {
  projectName: string;
  history: HistoryEntry[];
  totalPredictions: number;
}

interface RecordIssue {
  predictionId: number;
  problems: string[];
}

function checkPrediction(entry: HistoryEntry): string[] {
  const issues: string[] = [];

  if (
    !Number.isFinite(entry.risk_score) ||
    entry.risk_score < 0 ||
    entry.risk_score > 100
  ) {
    issues.push("Invalid risk score");
  }

  if (
    !Number.isFinite(entry.delay_probability) ||
    entry.delay_probability < 0 ||
    entry.delay_probability > 1
  ) {
    issues.push("Invalid delay probability");
  }

  if (
    !Number.isFinite(entry.predicted_delay_days) ||
    entry.predicted_delay_days < 0
  ) {
    issues.push("Invalid predicted delay");
  }

  if (
    entry.input_snapshot === null ||
    typeof entry.input_snapshot !== "object" ||
    Array.isArray(entry.input_snapshot) ||
    Object.keys(entry.input_snapshot).length === 0
  ) {
    issues.push("Input snapshot missing or empty");
  }

  if (
    !Array.isArray(entry.risk_factors) ||
    entry.risk_factors.length === 0
  ) {
    issues.push("Explanation factors missing");
  }

  if (!entry.model_version?.trim()) {
    issues.push("Model version missing");
  }

  if (!entry.created_at) {
    issues.push("Prediction timestamp missing");
  }

  return issues;
}

export default function ModelMonitoringPanel({
  projectName,
  history,
  totalPredictions,
}: Props) {
  const retrievedCount = history.length;

  const versions = Array.from(
    new Set(
      history
        .map((entry) => entry.model_version)
        .filter((version) => Boolean(version?.trim())),
    ),
  );

  const idCounts = new Map<number, number>();

  history.forEach((entry) => {
    idCounts.set(
      entry.prediction_id,
      (idCounts.get(entry.prediction_id) ?? 0) + 1,
    );
  });

  const duplicateIds = Array.from(idCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  const recordIssues: RecordIssue[] = history
    .map((entry) => ({
      predictionId: entry.prediction_id,
      problems: checkPrediction(entry),
    }))
    .filter((entry) => entry.problems.length > 0);

  const recordsWithIssues = recordIssues.length;

  const apparentlyCompleteRecords =
    retrievedCount - recordsWithIssues;

  const partialHistory = totalPredictions > retrievedCount;

  const highestIdRecord =
    [...history].sort(
      (a, b) => b.prediction_id - a.prediction_id,
    )[0] ?? null;

  const checks: string[] = [];

  if (partialHistory) {
    checks.push(
      "The API reports more predictions than were retrieved.",
    );
  }

  if (versions.length > 1) {
    checks.push(
      "Multiple model versions occur in the retrieved history.",
    );
  }

  if (duplicateIds.length > 0) {
    checks.push(
      `Duplicate prediction IDs: ${duplicateIds.join(", ")}`,
    );
  }

  if (recordIssues.length > 0) {
    checks.push(
      `${recordIssues.length} retrieved record(s) have data-quality issues.`,
    );
  }

  return (
    <div className="model-monitoring-panel">
      <div className="panel-heading">
        <div>
          <h2>Model Monitoring & Data Quality</h2>
          <p>
            Read-only checks for saved predictions of{" "}
            {projectName}.
          </p>
        </div>

        <span className="count-badge">
          {retrievedCount} records
        </span>
      </div>



      {retrievedCount === 0 ? (
        <p className="empty-state">
          No saved predictions were retrieved.
          Data-quality monitoring requires saved records.
        </p>
      ) : (
        <>
          <div className="detail-metrics">
            <div>
              <span>Retrieved Predictions</span>
              <strong>{retrievedCount}</strong>
            </div>

            <div>
              <span>API-Reported Predictions</span>
              <strong>{totalPredictions}</strong>
            </div>

            <div>
              <span>Records Passing These Checks</span>
              <strong>{apparentlyCompleteRecords}</strong>
            </div>

            <div>
              <span>Records With Issues</span>
              <strong>{recordsWithIssues}</strong>
            </div>
          </div>

          <h3>Model Version Information</h3>

          {versions.length === 0 ? (
            <p className="explanation-note">
              No valid model version was found.
            </p>
          ) : (
            <p className="explanation-note">
              Retrieved model version(s):{" "}
              {versions.join(", ")}
            </p>
          )}

          <p className="explanation-note">
            Highest prediction ID:{" "}
            {highestIdRecord
              ? `#${highestIdRecord.prediction_id}`
              : "—"}
            . IDs indicate record ordering here, not
            independently verified event chronology.
          </p>

          <h3>Monitoring Findings</h3>

          {checks.length === 0 ? (
            <p className="explanation-note">
              No issues were detected by these limited
              checks in the retrieved records. This does
              not establish that the predictions are
              accurate or operationally validated.
            </p>
          ) : (
            <div className="history-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Finding</th>
                  </tr>
                </thead>

                <tbody>
                  {checks.map((finding, index) => (
                    <tr key={`${index}-${finding}`}>
                      <td>{index + 1}</td>
                      <td>{finding}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {recordIssues.length > 0 && (
            <>
              <h3>Prediction-Level Issues</h3>

              <div className="history-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Prediction ID</th>
                      <th>Detected Issues</th>
                    </tr>
                  </thead>

                  <tbody>
                    {recordIssues.map((record, index) => (
                      <tr
                        key={`${record.predictionId}-${index}`}
                      >
                        <td>#{record.predictionId}</td>

                        <td>
                          {record.problems.join("; ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="explanation-note">
            Monitoring covers only records returned
            by the current history API request.
            Missing source records, incorrect real-world
            information, calibration, and actual delay
            outcomes cannot be verified here.
          </p>
        </>
      )}
    </div>
  );
}