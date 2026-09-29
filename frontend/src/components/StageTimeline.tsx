import type { HistoryEntry } from "../services/projectsApi";

interface StageTimelineProps {
  projectName: string;
  history: HistoryEntry[];
}

interface TimelineEntry {
  predictionId: number;
  stage: string;
  riskScore: number;
  riskLevel: string;
  timestamp: string | null;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";

  return value.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

function formatTimestamp(value: string | null): string {
  // Display the API's timestamp without inventing a timezone.
  return value
    ? value.replace("T", " ").slice(0, 19)
    : "Timestamp unavailable";
}

function getStage(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const stage = value.trim();

  return stage.length > 0 ? stage : null;
}

export default function StageTimeline({
  projectName,
  history,
}: StageTimelineProps) {
  // Prediction IDs represent the sequence in which records
  // were saved. They are NOT stage start or completion dates.
  const observations: TimelineEntry[] = history
    .map((record) => {
      const stage = getStage(
        record.input_snapshot?.current_stage
      );

      if (!stage) return null;

      return {
        predictionId: record.prediction_id,
        stage,
        riskScore: Number(record.risk_score),
        riskLevel: record.risk_level,
        timestamp: record.created_at,
      };
    })
    .filter(
      (entry): entry is TimelineEntry => entry !== null
    )
    .sort(
      (a, b) => a.predictionId - b.predictionId
    );

  const displayed = observations.slice(-12);

  const previousObservation =
    observations.length > displayed.length
      ? observations[
          observations.length - displayed.length - 1
        ]
      : null;

  return (
    <div className="stage-timeline">
      <div className="panel-heading">
        <div>
          <h2>Stage Observation Timeline</h2>

          <p>
            Saved project prediction snapshots for{" "}
            {projectName}.
          </p>
        </div>

        <span className="count-badge">
          {observations.length} observations
        </span>
      </div>

      <div className="stage-timeline-notice">
        This timeline shows stage values recorded when
        predictions were saved. It does not establish
        actual stage start dates, completion dates,
        or predicted remaining duration.
      </div>

      {observations.length === 0 ? (
        <p className="empty-state">
          No saved prediction snapshots contain a
          current-stage value.
        </p>
      ) : (
        <>
          <div className="stage-timeline-list">
            {displayed.map((entry, index) => {
              const previous =
                index === 0
                  ? previousObservation
                  : displayed[index - 1];

              const stageChanged =
                previous !== null &&
                previous.stage !== entry.stage;

              const riskDifference =
                previous !== null
                  ? entry.riskScore -
                    previous.riskScore
                  : null;

              return (
                <article
                  className="stage-timeline-item"
                  key={entry.predictionId}
                >
                  <div className="stage-timeline-marker">
                    <span className="stage-timeline-dot" />
                  </div>

                  <div className="stage-timeline-card">
                    <div className="stage-timeline-top">
                      <span>
                        Prediction #{entry.predictionId}
                      </span>

                      <span>
                        {formatTimestamp(
                          entry.timestamp
                        )}
                      </span>
                    </div>

                    <div className="stage-timeline-title">
                      <h3>
                        Recorded stage: {entry.stage}
                      </h3>

                      {stageChanged && (
                        <span className="stage-timeline-change">
                          Stage value changed
                        </span>
                      )}
                    </div>

                    <div className="stage-timeline-metrics">
                      <div>
                        <span>Project risk score</span>

                        <strong>
                          {formatNumber(
                            entry.riskScore
                          )}
                          /100
                        </strong>
                      </div>

                      <div>
                        <span>Recorded risk level</span>

                        <strong>
                          {entry.riskLevel}
                        </strong>
                      </div>

                      <div>
                        <span>
                          Change from previous observation
                        </span>

                        <strong>
                          {riskDifference === null ||
                          !Number.isFinite(
                            riskDifference
                          )
                            ? "—"
                            : `${
                                riskDifference > 0
                                  ? "+"
                                  : ""
                              }${formatNumber(
                                riskDifference
                              )} points`}
                        </strong>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {observations.length > displayed.length && (
            <p className="stage-timeline-footer">
              Showing the latest{" "}
              {displayed.length} of{" "}
              {observations.length} recorded
              observations.
            </p>
          )}

          <p className="stage-timeline-footer">
            Risk scores come from the project-delay
            model's saved predictions. They are not
            Stage-Delay Model 2 probabilities.
          </p>
        </>
      )}
    </div>
  );
}