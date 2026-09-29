import type { Project } from "../services/projectsApi";

interface Props {
  projects: Project[];
  totalProjects: number;
}

type RiskCategory =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL"
  | "UNKNOWN"
  | "NOT PREDICTED";

export default function PortfolioAnalyticsPanel({
  projects,
  totalProjects,
}: Props) {
  const categories: RiskCategory[] = [
    "LOW",
    "MEDIUM",
    "HIGH",
    "CRITICAL",
    "UNKNOWN",
    "NOT PREDICTED",
  ];

  const counts: Record<RiskCategory, number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
    UNKNOWN: 0,
    "NOT PREDICTED": 0,
  };

  for (const project of projects) {
    const prediction = project.latest_prediction;

    if (!prediction) {
      counts["NOT PREDICTED"] += 1;
      continue;
    }

    const risk = prediction.risk_level?.toUpperCase();

    if (
      risk === "LOW" ||
      risk === "MEDIUM" ||
      risk === "HIGH" ||
      risk === "CRITICAL"
    ) {
      counts[risk] += 1;
    } else {
      counts.UNKNOWN += 1;
    }
  }

  const loadedCount = projects.length;

  const predictedCount =
    loadedCount - counts["NOT PREDICTED"];

  return (
    <div className="portfolio-analytics">
      <div className="panel-heading">
        <div>
          <h2>Portfolio Risk Analytics</h2>
          <p>
            Risk distribution from the latest saved
            predictions of loaded projects.
          </p>
        </div>

        <span className="count-badge">
          {loadedCount}
        </span>
      </div>



      <div className="detail-metrics">
        <div>
          <span>Projects Loaded</span>
          <strong>{loadedCount}</strong>
        </div>

        <div>
          <span>Projects Predicted</span>
          <strong>{predictedCount}</strong>
        </div>

        <div>
          <span>Total Projects Reported</span>
          <strong>{totalProjects}</strong>
        </div>
      </div>

      {loadedCount === 0 ? (
        <p className="empty-state">
          No project data is available for analysis.
        </p>
      ) : (
        <div>
          {categories.map((category) => {
            const count = counts[category];
            const percentage =
              (count / loadedCount) * 100;

            return (
              <div key={category} style={{ marginTop: 18 }}>
                <div className="progress-label">
                  <span>
                    {category.replace("_", " ")}
                  </span>

                  <strong>
                    {count} / {loadedCount}
                    {" · "}
                    {percentage.toFixed(1)}%
                  </strong>
                </div>

                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label={`${category} project share`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percentage}
                >
                  <div
                    className="progress-fill"
                    style={{
                      width: `${percentage}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="explanation-note">
        This analysis covers {loadedCount} loaded project(s).
        {totalProjects > loadedCount
          ? " Additional projects exist in the API but are not included in this view."
          : " All projects reported by the API are currently loaded."}
      </p>
    </div>
  );
}