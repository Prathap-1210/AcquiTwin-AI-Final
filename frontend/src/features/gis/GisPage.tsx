import {
  useMemo,
  useState,
} from "react";

import ProjectMap from "../../components/ProjectMap";

import type {
  Project,
} from "../../services/projectsApi";


interface GisPageProps {
  projects: Project[];

  selectedProject: Project | null;

  onSelectProject: (
    project: Project
  ) => void;
}


function normalizedRisk(
  project: Project
): string {

  return (
    project.latest_prediction
      ?.risk_level
      ?.trim()
      .toUpperCase()
    ||
    "NO_PREDICTION"
  );
}


function formatProbability(
  value: number | null | undefined
): string {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "Not recorded";
  }

  const percent =
    value <= 1
      ? value * 100
      : value;

  return `${percent.toFixed(2)}%`;
}


function landProgress(
  project: Project
): string {

  const total =
    project.total_land_area;

  const acquired =
    project.acquired_land_area;

  if (
    total === null ||
    acquired === null ||
    total <= 0
  ) {
    return "Not recorded";
  }

  const percent =
    Math.min(
      100,
      Math.max(
        0,
        (acquired / total) * 100
      )
    );

  return `${percent.toFixed(1)}%`;
}


export default function GisPage({
  projects,
  selectedProject,
  onSelectProject,
}: GisPageProps) {

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    stateFilter,
    setStateFilter,
  ] = useState("ALL");

  const [
    riskFilter,
    setRiskFilter,
  ] = useState("ALL");

  const [
    stageFilter,
    setStageFilter,
  ] = useState("ALL");


  // ==========================================================
  // FILTER OPTIONS
  // ==========================================================

  const states =
    useMemo(
      () =>
        Array.from(
          new Set(
            projects
              .map(
                (project) =>
                  project.state
                    ?.trim()
              )
              .filter(
                (
                  value
                ): value is string =>
                  Boolean(value)
              )
          )
        ).sort(),
      [projects]
    );


  const stages =
    useMemo(
      () =>
        Array.from(
          new Set(
            projects
              .map(
                (project) =>
                  project.current_stage
                    ?.trim()
              )
              .filter(
                (
                  value
                ): value is string =>
                  Boolean(value)
              )
          )
        ).sort(),
      [projects]
    );


  // ==========================================================
  // FILTER PROJECTS
  // ==========================================================

  const filteredProjects =
    useMemo(
      () => {

        const query =
          search
            .trim()
            .toLowerCase();


        return projects.filter(
          (project) => {

            // ----------------------------------------------
            // SEARCH
            // ----------------------------------------------

            const matchesSearch =
              !query ||
              [
                project.project_id,
                project.project_name,
                project.project_type,
                project.implementing_agency,
                project.state,
                project.district,
                project.current_stage,
              ]
                .filter(Boolean)
                .some(
                  (value) =>
                    String(value)
                      .toLowerCase()
                      .includes(query)
                );


            // ----------------------------------------------
            // STATE
            // ----------------------------------------------

            const matchesState =
              stateFilter === "ALL" ||
              project.state ===
                stateFilter;


            // ----------------------------------------------
            // RISK
            // ----------------------------------------------

            const matchesRisk =
              riskFilter === "ALL" ||
              normalizedRisk(project) ===
                riskFilter;


            // ----------------------------------------------
            // STAGE
            // ----------------------------------------------

            const matchesStage =
              stageFilter === "ALL" ||
              project.current_stage ===
                stageFilter;


            return (
              matchesSearch &&
              matchesState &&
              matchesRisk &&
              matchesStage
            );
          }
        );
      },
      [
        projects,
        search,
        stateFilter,
        riskFilter,
        stageFilter,
      ]
    );


  // ==========================================================
  // PROJECTS WITH COORDINATES
  // ==========================================================

  const mappedCount =
    useMemo(
      () =>
        filteredProjects.filter(
          (project) =>
            typeof project.latitude ===
              "number" &&
            Number.isFinite(
              project.latitude
            ) &&
            typeof project.longitude ===
              "number" &&
            Number.isFinite(
              project.longitude
            )
        ).length,
      [filteredProjects]
    );


  // ==========================================================
  // CLEAR FILTERS
  // ==========================================================

  function clearFilters(): void {

    setSearch("");
    setStateFilter("ALL");
    setRiskFilter("ALL");
    setStageFilter("ALL");
  }


  return (

    <section className="gis-page">

      {/* ======================================================
          PAGE HEADER
      ====================================================== */}

      <header className="gis-page-header">

        <div>

          <span className="eyebrow">
            GEOSPATIAL INTELLIGENCE
          </span>

          <h2>
            GIS Project Map
          </h2>

          <p>
            Visualize AcquiTwin project locations using
            recorded latitude and longitude coordinates,
            together with the latest saved ML risk
            prediction.
          </p>

        </div>


        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >

          <span className="count-badge">
            {mappedCount} mapped
          </span>

          <span className="count-badge">
            {filteredProjects.length} shown
          </span>

        </div>

      </header>


      {/* ======================================================
          GIS FILTERS
      ====================================================== */}

      <div className="gis-filter-bar">

        {/* SEARCH */}

        <label>

          Search project

          <input
            type="search"

            value={search}

            onChange={
              (event) =>
                setSearch(
                  event.target.value
                )
            }

            placeholder={
              "Project name, code, state, district..."
            }
          />

        </label>


        {/* STATE */}

        <label>

          State

          <select
            value={stateFilter}

            onChange={
              (event) =>
                setStateFilter(
                  event.target.value
                )
            }
          >

            <option value="ALL">
              All states
            </option>

            {
              states.map(
                (state) => (

                  <option
                    key={state}
                    value={state}
                  >
                    {state}
                  </option>

                )
              )
            }

          </select>

        </label>


        {/* RISK */}

        <label>

          Saved risk level

          <select
            value={riskFilter}

            onChange={
              (event) =>
                setRiskFilter(
                  event.target.value
                )
            }
          >

            <option value="ALL">
              All risk levels
            </option>

            <option value="LOW">
              Low
            </option>

            <option value="MEDIUM">
              Medium
            </option>

            <option value="HIGH">
              High
            </option>

            <option value="CRITICAL">
              Critical
            </option>

            <option value="NO_PREDICTION">
              No saved prediction
            </option>

          </select>

        </label>


        {/* STAGE */}

        <label>

          Current stage

          <select
            value={stageFilter}

            onChange={
              (event) =>
                setStageFilter(
                  event.target.value
                )
            }
          >

            <option value="ALL">
              All stages
            </option>

            {
              stages.map(
                (stage) => (

                  <option
                    key={stage}
                    value={stage}
                  >
                    {stage}
                  </option>

                )
              )
            }

          </select>

        </label>

      </div>


      {/* ======================================================
          FILTER SUMMARY
      ====================================================== */}

      {
        (
          search ||
          stateFilter !== "ALL" ||
          riskFilter !== "ALL" ||
          stageFilter !== "ALL"
        ) && (

          <div
            className=
              "project-filter-summary"
          >

            <span>
              Showing{" "}
              <strong>
                {
                  filteredProjects.length
                }
              </strong>{" "}
              of{" "}
              <strong>
                {projects.length}
              </strong>{" "}
              projects.
            </span>


            <button
              type="button"

              className=
                "project-filter-clear"

              onClick=
                {clearFilters}
            >
              Clear GIS filters
            </button>

          </div>
        )
      }


      {/* ======================================================
          SELECTED PROJECT
      ====================================================== */}

      {
        selectedProject && (

          <div
            className=
              "gis-selected-project"
          >

            <div>

              <span>
                Selected project
              </span>

              <strong>
                {
                  selectedProject.project_id
                }
                {" — "}
                {
                  selectedProject.project_name
                }
              </strong>

            </div>


            <div>

              <span>
                Current stage
              </span>

              <strong>
                {
                  selectedProject
                    .current_stage
                  ||
                  "Not recorded"
                }
              </strong>

            </div>


            <div>

              <span>
                Saved risk
              </span>

              <strong>
                {
                  selectedProject
                    .latest_prediction
                    ?.risk_level
                  ||
                  "No saved prediction"
                }
              </strong>

            </div>


            <div>

              <span>
                Delay probability
              </span>

              <strong>
                {
                  formatProbability(
                    selectedProject
                      .latest_prediction
                      ?.delay_probability
                  )
                }
              </strong>

            </div>


            <div>

              <span>
                Land acquired
              </span>

              <strong>
                {
                  landProgress(
                    selectedProject
                  )
                }
              </strong>

            </div>


            <div>

              <span>
                District
              </span>

              <strong>
                {
                  selectedProject.district
                  ||
                  "Not recorded"
                }
              </strong>

            </div>


            <div>

              <span>
                Latitude
              </span>

              <strong>
                {
                  typeof
                    selectedProject.latitude
                  === "number"

                    ? selectedProject.latitude
                        .toFixed(6)

                    : "Not recorded"
                }
              </strong>

            </div>


            <div>

              <span>
                Longitude
              </span>

              <strong>
                {
                  typeof
                    selectedProject.longitude
                  === "number"

                    ? selectedProject.longitude
                        .toFixed(6)

                    : "Not recorded"
                }
              </strong>

            </div>

          </div>
        )
      }


      {/* ======================================================
          MAP
      ====================================================== */}

      {
        filteredProjects.length > 0
          ? (

              <ProjectMap
                projects=
                  {filteredProjects}

                selectedProject=
                  {selectedProject}

                onSelectProject=
                  {onSelectProject}
              />

            )
          : (

              <div className="panel">

                <p className="empty-state">
                  No project records match the
                  current GIS filters.
                </p>

              </div>

            )
      }


      {/* ======================================================
          GIS EVIDENCE NOTE
      ====================================================== */}

      <div className="demo-notice">

        GIS locations are shown only when latitude
        and longitude are recorded for the project.
        Marker risk colours represent the latest
        saved AcquiTwin ML prediction and are not a
        separate geospatial-risk assessment.

      </div>

    </section>
  );
}