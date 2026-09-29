import type { Project } from "../services/projectsApi";

interface Props {
  projects: Project[];
  onSelectProject: (projectId: number) => void;
}

type ReviewNotice = {
  id: string;
  project: Project;
  type: "MODEL REVIEW" | "DATA CHECK";
  reason: string;
  nextStep: string;
  score: number | null;
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function createNotices(projects: Project[]): ReviewNotice[] {
  const notices: ReviewNotice[] = [];

  for (const project of projects) {
    const prediction = project.latest_prediction;
    const score = finiteNumber(prediction?.risk_score);

    // Use the backend's saved classification; do not invent a new cutoff.
    if (prediction?.risk_level?.toUpperCase() === "HIGH") {
      notices.push({
        id: `${project.id}-model-review`,
        project,
        type: "MODEL REVIEW",
        score,
        reason: `Latest saved model classification: HIGH${score !== null ? ` (${score.toFixed(1)}/100)` : ""}.`,
        nextStep: "Review the saved model inputs and explanation factors; verify current project records before deciding on an action.",
      });
    }

    const total = finiteNumber(project.total_land_area);
    const acquired = finiteNumber(project.acquired_land_area);
    const invalidArea =
      (total !== null && total < 0) ||
      (acquired !== null && acquired < 0) ||
      (total !== null && acquired !== null && acquired > total);

    if (invalidArea) {
      notices.push({
        id: `${project.id}-area-check`,
        project,
        type: "DATA CHECK",
        score: null,
        reason: `Land area values need review: total ${total ?? "unavailable"} ha; acquired ${acquired ?? "unavailable"} ha.`,
        nextStep: "Check the source records and correct any confirmed inconsistency through the authorized data-entry workflow.",
      });
    }
  }

  // Group review notices by project score without assigning new risk scores.
  return notices.sort((a, b) => {
    const scoreDifference = (b.score ?? -1) - (a.score ?? -1);
    return scoreDifference || a.project.project_id.localeCompare(b.project.project_id);
  });
}

export default function RiskReviewAlertsPanel({
  projects,
  onSelectProject,
}: Props) {
  const notices = createNotices(projects);
  const modelNotices = notices.filter((notice) => notice.type === "MODEL REVIEW").length;
  const dataChecks = notices.filter((notice) => notice.type === "DATA CHECK").length;

  return (
    <div className="risk-review-alerts">
      <div className="panel-heading">
        <div>
          <h2>Review Alerts &amp; Suggested Checks</h2>
          <p>Read-only notices derived from the latest data for the loaded projects.</p>
        </div>
        <span className="count-badge">{notices.length}</span>
      </div>

      <p className="explanation-note">
        {modelNotices} model review notice(s) and {dataChecks} land-data check(s)
        among {projects.length} loaded project(s). These notices are calculated in
        the browser: they are not saved alerts, verified findings, notifications,
        or evidence that a suggested action will reduce delay. The HIGH label comes
        from a model trained on  development data.
      </p>

      {notices.length === 0 ? (
        <p className="empty-state">
          No notices matched these two checks among the loaded projects. This
          does not mean all projects are delay-free or that their records are complete.
        </p>
      ) : (
        <div className="history-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Notice</th>
                <th>Project</th>
                <th>Reason</th>
                <th>Suggested review</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {notices.map((notice) => (
                <tr key={notice.id}>
                  <td>
                    <span className={`risk-badge ${notice.type === "MODEL REVIEW" ? "high" : "medium"}`}>
                      {notice.type}
                    </span>
                  </td>
                  <td>
                    <strong>{notice.project.project_id}</strong>
                    <br />
                    <small>{notice.project.project_name}</small>
                  </td>
                  <td>{notice.reason}</td>
                  <td>{notice.nextStep}</td>
                  <td>
                    <button
                      type="button"
                      className="refresh-button"
                      onClick={() => onSelectProject(notice.project.id)}
                    >
                      View Project
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
