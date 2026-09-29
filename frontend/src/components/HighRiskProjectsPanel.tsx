import type { Project } from "../services/projectsApi";

interface Props {
  projects: Project[];
  onSelectProject: (projectId: number) => void;
}

function formatNumber(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }

  return Number(value).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
  });
}

function riskClass(level: string | null | undefined): string {
  const value = (level ?? "").toUpperCase();

  if (value === "HIGH") return "high";
  if (value === "MEDIUM") return "medium";
  if (value === "LOW") return "low";

  return "unknown";
}

export default function HighRiskProjectsPanel({
  projects,
  onSelectProject,
}: Props) {
  const predictedProjects = projects
    .filter((project) => project.latest_prediction !== null)
    .sort(
      (a, b) =>
        Number(b.latest_prediction?.risk_score ?? 0) -
        Number(a.latest_prediction?.risk_score ?? 0),
    );

  const highRiskProjects = predictedProjects.filter(
    (project) =>
      project.latest_prediction?.risk_level?.toUpperCase() ===
      "HIGH",
  );

  return (
    <div className="high-risk-panel">
      <div className="panel-heading">
        <div>
          <h2>High-Risk Project Prioritization</h2>

          <p>
            Projects are ordered using their latest saved
            model risk score.
          </p>
        </div>

        <span className="count-badge">
          {highRiskProjects.length}
        </span>
      </div>



      {predictedProjects.length === 0 ? (
        <p className="empty-state">
          No saved project predictions are available.
        </p>
      ) : highRiskProjects.length === 0 ? (
        <p className="empty-state">
          No loaded project currently has a latest prediction
          classified as HIGH.
        </p>
      ) : (
        <div className="history-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Location</th>
                <th>Stage</th>
                <th>Risk Score</th>
                <th>Delay Probability</th>
                <th>Risk</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {highRiskProjects.map((project) => {
                const prediction = project.latest_prediction;

                if (!prediction) return null;

                return (
                  <tr key={project.id}>
                    <td>
                      <strong>{project.project_id}</strong>
                      <br />
                      <small>{project.project_name}</small>
                    </td>

                    <td>
                      {project.district}, {project.state}
                    </td>

                    <td>{project.current_stage}</td>

                    <td>
                      {formatNumber(prediction.risk_score)}
                      /100
                    </td>

                    <td>
                      {formatNumber(
                        prediction.delay_probability * 100,
                      )}
                      %
                    </td>

                    <td>
                      <span
                        className={`risk-badge ${riskClass(
                          prediction.risk_level,
                        )}`}
                      >
                        {prediction.risk_level}
                      </span>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="refresh-button"
                        onClick={() =>
                          onSelectProject(project.id)
                        }
                      >
                        View Project
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}