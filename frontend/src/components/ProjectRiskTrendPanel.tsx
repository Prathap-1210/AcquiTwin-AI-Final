import type { HistoryEntry } from "../services/projectsApi";

interface Props {
  projectName: string;
  history: HistoryEntry[];
  totalPredictions: number;
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";

  // Preserve the API's timestamp without assuming a timezone.
  return value.replace("T", " ").slice(0, 19);
}

export default function ProjectRiskTrendPanel({
  projectName,
  history,
  totalPredictions,
}: Props) {
  // Use saved prediction IDs to order the retrieved observations.
  // Do not interpret them as actual project milestone events.
  const observations = [...history]
    .filter((entry) =>
      Number.isFinite(Number(entry.risk_score)),
    )
    .sort(
      (a, b) => a.prediction_id - b.prediction_id,
    );

  const earliest = observations[0] ?? null;
  const latest = observations[observations.length - 1] ?? null;

  const modelVersions = new Set(
    observations.map((entry) => entry.model_version),
  );

  const comparable =
    observations.length >= 2 &&
    modelVersions.size === 1;

  const scoreChange =
    comparable && earliest && latest
      ? latest.risk_score - earliest.risk_score
      : null;

  const recentObservations = observations
    .slice(-10)
    .reverse();

  return (
    <div className="project-risk-trend-panel">
      <div className="panel-heading">
        <div>
          <h2>Project Risk Trend Analysis</h2>

          <p>
            Changes across saved model predictions for
            {" "}
            {projectName}.
          </p>
        </div>

        <span className="count-badge">
          {observations.length}
        </span>
      </div>



      {observations.length === 0 ? (
        <p className="empty-state">
          No saved prediction history is available.
        </p>
      ) : (
        <>
          <div className="detail-metrics">
            <div>
              <span>Earliest Retrieved Score</span>

              <strong>
                {earliest
                  ? `${formatScore(earliest.risk_score)}/100`
                  : "—"}
              </strong>
            </div>

            <div>
              <span>Latest Retrieved Score</span>

              <strong>
                {latest
                  ? `${formatScore(latest.risk_score)}/100`
                  : "—"}
              </strong>
            </div>

            <div>
              <span>Score Change</span>

              <strong>
                {scoreChange === null
                  ? "Not comparable"
                  : `${
                      scoreChange > 0 ? "+" : ""
                    }${formatScore(scoreChange)} points`}
              </strong>
            </div>
          </div>

          {modelVersions.size > 1 && (
            <p className="explanation-note">
              Multiple model versions occur in the retrieved
              history. A single overall score change is not
              displayed because their outputs may not be
              directly comparable.
            </p>
          )}

          {observations.length < totalPredictions && (
            <p className="explanation-note">
              Showing {observations.length} valid retrieved
              prediction(s) out of {totalPredictions} reported
              by the API. This may be a partial history.
            </p>
          )}

          <h3>Recent Prediction Scores</h3>

          {recentObservations.map((entry) => {
            const score = Math.max(
              0,
              Math.min(100, Number(entry.risk_score)),
            );

            return (
              <div
                key={entry.prediction_id}
                style={{ marginTop: 18 }}
              >
                <div className="progress-label">
                  <span>
                    Prediction #{entry.prediction_id}
                  </span>

                  <strong>
                    {formatScore(entry.risk_score)}/100
                  </strong>
                </div>

                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label={`Prediction ${entry.prediction_id} risk score`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={score}
                >
                  <div
                    className="progress-fill"
                    style={{
                      width: `${score}%`,
                    }}
                  />
                </div>

                <small>
                  {formatTimestamp(entry.created_at)}
                  {" · "}
                  {entry.risk_level}
                  {" · "}
                  {entry.model_version}
                </small>
              </div>
            );
          })}

          <p className="explanation-note">
            Showing up to 10 recent predictions. The
            comparison above uses all valid records returned
            by the history API.
          </p>
        </>
      )}
    </div>
  );
}