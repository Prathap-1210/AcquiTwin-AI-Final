import { useCallback, useEffect, useState, type ReactNode } from "react";

import ProjectRiskTrendPanel from "./components/ProjectRiskTrendPanel";

import PredictionComparisonPanel from "./components/PredictionComparisonPanel";

import ModelMonitoringPanel from "./components/ModelMonitoringPanel";

import {

  getPredictionHistory,

  getProjects,

  type HistoryEntry,

  type Project,

} from "./services/projectsApi";

import PredictionForm from "./components/PredictionForm";

import WhatIfSimulator from "./components/WhatIfSimulator";

import InterventionPanel from "./components/InterventionPanel";

import StageDelayPanel from "./components/StageDelayPanel";

import StageTimeline from "./components/StageTimeline";

import StageEventsPanel from "./components/StageEventsPanel";

import StageBottlenecksPanel from "./components/StageBottlenecksPanel";

import StageReadinessPanel from "./components/StageReadinessPanel";

import StageEvidenceExport from "./components/StageEvidenceExport";

import HighRiskProjectsPanel from "./components/HighRiskProjectsPanel";

import RiskReviewAlertsPanel from "./components/RiskReviewAlertsPanel";

import PortfolioAnalyticsPanel from "./components/PortfolioAnalyticsPanel";

import PortfolioExportPanel from "./components/PortfolioExportPanel";

import AssistantPanel from "./components/AssistantPanel";

import AddProjectModal, { STATES, UNION_TERRITORIES } from "./components/AddProjectModal";

import "./App.css";

import DocumentIntelligencePanel from "./components/DocumentIntelligencePanel";

import GisPage from "./features/gis/GisPage";



function formatNumber(value: number | null | undefined, digits = 2): string {

  if (value == null || !Number.isFinite(Number(value))) return "—";

  return Number(value).toLocaleString("en-IN", {

    maximumFractionDigits: digits,

  });

}



function formatTimestamp(value: string | null): string {

  // The backend currently sends timestamps without a timezone.

  // Display the original wall time without guessing a timezone.

  return value ? value.replace("T", " ").slice(0, 19) : "—";

}



function riskClass(level: string | null | undefined): string {

  const normalized = (level ?? "").toUpperCase();

  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(normalized)

    ? normalized.toLowerCase()

    : "unknown";

}



type Page =

  | "overview"

  | "projects"

  | "predictions"

  | "scenarios"

  | "insights"

  | "stages"

  | "documents"

  | "gis"

  | "reports"

  | "settings"

  | "account";

type InsightTab = "trend" | "comparison" | "monitoring" | "history";

type StageTab = "model" | "records" | "readiness" | "bottlenecks" | "timeline";



const PAGE_NAV: {

  page: Page;

  label: string;

  description: string;

}[] = [

  {

    page: "overview",

    label: "Overview",

    description: "Portfolio at a glance",

  },

  {

    page: "projects",

    label: "Projects",

    description: "Search and project details",

  },

  {

    page: "predictions",

    label: "Predictions",

    description: "Run the project-delay model",

  },

  {

    page: "scenarios",

    label: "Scenarios",

    description: "What-if and interventions",

  },

  {

    page: "insights",

    label: "Insights",

    description: "Trends and monitoring",

  },

  {

    page: "stages",

    label: "Stages",

    description: "Stage intelligence",

  },

  {

    page: "documents",

    label: "Documents",

    description: "AI document scanning and verification",

  },

  {

    page: "gis",

    label: "GIS Map",

    description: "Project geospatial intelligence",

  },

  {

    page: "reports",

    label: "Reports",

    description: "CSV and PDF downloads",

  },

  {

    page: "settings",

    label: "Settings",

    description: "Display preferences",

  },

  {

    page: "account",

    label: "Account",

    description: "Session information",

  },

];



const INSIGHT_TABS: { tab: InsightTab; label: string }[] = [

  { tab: "trend", label: "Risk trends" },

  { tab: "comparison", label: "Compare" },

  { tab: "monitoring", label: "Monitoring" },

  { tab: "history", label: "History" },

];

const STAGE_TABS: { tab: StageTab; label: string }[] = [

  { tab: "model", label: "Stage model" },

  { tab: "records", label: "Stage records" },

  { tab: "readiness", label: "Data readiness" },

  { tab: "bottlenecks", label: "Bottlenecks" },

  { tab: "timeline", label: "Timeline" },

];



function currentRoute(): { page: Page; insightTab: InsightTab; stageTab: StageTab } {

  const [requestedPage, requestedTab] = window.location.hash.replace(/^#\/?/, "").split("/");

  const page = PAGE_NAV.find((item) => item.page === requestedPage)?.page ?? "overview";

  const insightTab = INSIGHT_TABS.find((item) => item.tab === requestedTab)?.tab ?? "trend";

  const stageTab = STAGE_TABS.find((item) => item.tab === requestedTab)?.tab ?? "model";

  return { page, insightTab, stageTab };

}



// Photo: DP Singh Bhullar, Wikimedia Commons, CC BY-SA 4.0.

// Keep the visible attribution/link in the navigation footer when using this photo.

const LAND_PHOTO =

  "https://commons.wikimedia.org/wiki/Special:FilePath/Aerial_view_of_agricultural_fields_in_Punjab,_India.jpg?width=512";

const LAND_PHOTO_CREDIT =

  "https://commons.wikimedia.org/wiki/File:Aerial_view_of_agricultural_fields_in_Punjab,_India.jpg";



function Chakra({ className = "" }: { className?: string }) {

  return (

    <svg

      className={className}

      viewBox="0 0 100 100"

      fill="none"

      aria-hidden="true"

      focusable="false"

    >

      <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="2.5" />

      <circle cx="50" cy="50" r="7" fill="currentColor" />

      {Array.from({ length: 24 }, (_, index) => {

        const a = (index * Math.PI) / 12;

        return (

          <line

            key={index}

            x1={50 + 9 * Math.cos(a)}

            y1={50 + 9 * Math.sin(a)}

            x2={50 + 43 * Math.cos(a)}

            y2={50 + 43 * Math.sin(a)}

            stroke="currentColor"

            strokeWidth="1.5"

          />

        );

      })}

    </svg>

  );

}



function NavIcon({ page }: { page: Page }) {

  const paths: Record<Page, ReactNode> = {

    overview: <><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-8h6v8"/></>,

    projects: <path d="M3 7h7l2 3h9v10H3zM3 7V5h7l2 2" />,

    predictions: <><path d="M4 20V9h4v11M10 20V4h4v16M16 20v-7h4v7"/></>,

    scenarios: <><path d="M12 21s-7-4-7-10a7 7 0 1 1 14 0c0 6-7 10-7 10Z"/><circle cx="12" cy="11" r="2"/></>,

    insights: <><path d="M9 18h6m-5 3h4M9 15c-2-1-4-3-4-6a7 7 0 0 1 14 0c0 3-2 5-4 6"/></>,

    stages: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 17l9 5 9-5"/></>,

    documents: (

  <>

    <path d="M6 3h8l5 5v13H6z" />

    <path d="M14 3v6h5" />

    <path d="M9 13h7" />

    <path d="M9 17h5" />

    <path d="M3 8v10" />

  </>

),

    gis: (

      <>

        <path d="M12 21s-7-4-7-10a7 7 0 1 1 14 0c0 6-7 10-7 10Z" />

        <circle cx="12" cy="11" r="2.5" />

        <path d="M4 5.5 8 3l4 2.5L16 3l4 2.5v13L16 21l-4-2.5L8 21l-4-2.5z" />

      </>

    ),

    reports: <><path d="M6 3h8l5 5v13H6zM14 3v6h5M9 13h7M9 17h7"/></>,

    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,

    account: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,

  };

  return (

    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"

      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">

      {paths[page]}

    </svg>

  );

}



/** Decorative KPI icons only: all KPI values still come from the real API. */

function StatIcon({ type }: { type: "projects" | "risk" | "predicted" | "selected" }) {

  const shapes: Record<typeof type, ReactNode> = {

    projects: <><path d="M3 7h7l2 3h9v10H3z"/><path d="M3 7V5h7l2 2"/></>,

    risk: <><path d="m12 3 10 18H2L12 3z"/><path d="M12 9v5m0 3h.01"/></>,

    predicted: <><rect x="3" y="13" width="4" height="8" rx="1"/><rect x="10" y="9" width="4" height="12" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1"/></>,

    selected: <><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></>,

  };

  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"

    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[type]}</svg>;

}



/** Purely decorative land, trees and a gateway silhouette; no official symbol. */

function SidebarLandscape() {

  return (

    <svg className="sidebar-landscape" viewBox="0 0 270 230" preserveAspectRatio="xMidYMax slice"

      aria-hidden="true" focusable="false">

      <defs>

        <linearGradient id="landscapeFade" x1="0" y1="0" x2="0" y2="1">

          <stop offset="0" stopColor="#008b45" stopOpacity="0"/>

          <stop offset="1" stopColor="#004328" stopOpacity="1"/>

        </linearGradient>

      </defs>

      <path d="M0 68Q55 93 108 62T270 45V230H0Z" fill="#087d40"/>

      <path d="M0 114Q95 91 150 112T270 100V230H0Z" fill="url(#landscapeFade)"/>

      <g fill="none" stroke="#4eaa64" strokeWidth="1.7" opacity=".55">

        <path d="M-15 160Q68 121 285 180M-15 181Q73 144 285 205M-15 199Q88 173 285 230"/>

        <path d="M-35 228Q32 128 155 228M40 236Q97 143 242 230M100 242Q160 159 300 226"/>

      </g>

      <g fill="#00462a" opacity=".8">

        <path d="M8 143l9-23 9 23h-5v15h-8v-15zm35 7 9-24 9 24h-5v14h-8v-14zm182 0 9-24 9 24h-5v14h-8v-14zm24-8 9-21 9 21h-5v16h-8v-16z"/>

        <path d="M0 169Q68 146 123 163T270 157V181H0Z"/>

      </g>

      <g fill="#003d26" transform="translate(155 102)">

        <path d="M0 53V14l8-5V4h37v5l8 5v39h-8V23H8v30z"/>

        <path d="M17 53V34a10 10 0 0 1 20 0v19h-7V36a3 3 0 0 0-6 0v17z"/>

        <path d="M-3 15h59v5H-3zm7-10h45v5H4zm8-6h29v5H12zM-5 53h63v5H-5z"/>

      </g>

    </svg>

  );

}



function App() {

  const [route, setRoute] = useState(currentRoute);

  const [assistantOpen, setAssistantOpen] = useState(false);

  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const [projectCreateOpen, setProjectCreateOpen] = useState(false);

  const [projectEditing, setProjectEditing] = useState<Project | null>(null);

  const [creationMessage, setCreationMessage] = useState("");

  const [compactCards, setCompactCards] = useState(false);

  const [reduceMotion, setReduceMotion] = useState(false);

  const [hidePortrait, setHidePortrait] = useState(false);

  const { page, insightTab, stageTab } = route;



  useEffect(() => {

    const syncRoute = () => {

      setRoute(currentRoute());

      window.scrollTo({ top: 0, behavior: "auto" });

    };

    window.addEventListener("hashchange", syncRoute);

    return () => window.removeEventListener("hashchange", syncRoute);

  }, []);



  const [projects, setProjects] = useState<Project[]>([]);

  const [totalProjects, setTotalProjects] = useState(0);

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [loadingProjects, setLoadingProjects] = useState(true);

  const [projectError, setProjectError] = useState("");

  const [activeProjectSearch, setActiveProjectSearch] = useState("");



  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [historyForId, setHistoryForId] = useState<number | null>(null);

  const [totalPredictions, setTotalPredictions] = useState(0);

  const [loadingHistory, setLoadingHistory] = useState(false);

  const [historyError, setHistoryError] = useState("");

  const [historyRevision, setHistoryRevision] = useState(0);

  const [stageDataRevision, setStageDataRevision] = useState(0);

  // Search all projects loaded from the paginated API.

  const [projectSearch, setProjectSearch] = useState("");

  const [projectRiskFilter, setProjectRiskFilter] = useState("ALL");

  const [projectStateFilter, setProjectStateFilter] = useState("ALL");



  const loadProjects = useCallback(async (): Promise<void> => {

    setLoadingProjects(true);

    setProjectError("");

    try {

      const pageSize = 100;

      const response = await getProjects(pageSize, 0);

      const allProjects = [...response.projects];

      // Fetch every page so imported Bhoomi Rashi records appear in search

      // and in the active-project selector, not just the first 100 records.

      for (let offset = pageSize; offset < response.total_projects; offset += pageSize * 4) {

        const offsets = [offset, offset + pageSize, offset + pageSize * 2, offset + pageSize * 3]

          .filter((value) => value < response.total_projects);

        const pages = await Promise.all(offsets.map((value) => getProjects(pageSize, value)));

        for (const page of pages) allProjects.push(...page.projects);

      }

      setProjects(allProjects);

      setTotalProjects(response.total_projects);

      setSelectedId((previous) =>

        allProjects.some((project) => project.id === previous)

          ? previous

          : (allProjects[0]?.id ?? null),

      );

    } catch (error) {

      setProjectError(

        error instanceof Error ? error.message : "Unable to load projects.",

      );

    } finally {

      setLoadingProjects(false);

    }

  }, []);



  useEffect(() => {

    void loadProjects();

  }, [loadProjects]);



  useEffect(() => {

    if (selectedId === null) {

      setHistory([]);

      setHistoryForId(null);

      setTotalPredictions(0);

      setHistoryError("");

      setLoadingHistory(false);

      return;

    }



    let cancelled = false;

    const projectId = selectedId;



    async function loadHistory(): Promise<void> {

      setLoadingHistory(true);

      setHistoryError("");

      try {

        const response = await getPredictionHistory(projectId);

        if (cancelled) return;

        setHistory(response.history);

        setTotalPredictions(response.total_predictions);

        setHistoryForId(projectId);

      } catch (error) {

        if (cancelled) return;

        setHistoryError(

          error instanceof Error

            ? error.message

            : "Unable to load prediction history.",

        );

      } finally {

        if (!cancelled) setLoadingHistory(false);

      }

    }



    void loadHistory();

    return () => {

      cancelled = true;

    };

  }, [selectedId, historyRevision]);



  function selectProject(projectId: number): void {

    setSelectedId(projectId);

    window.location.hash = "#/projects";

    window.scrollTo({ top: 0, behavior: "auto" });

  }



  function handleProjectCreated(project: Project): void {

    setProjects((previous) => previous.some((item) => item.id === project.id)

      ? previous : [...previous, project]);

    setTotalProjects((previous) => previous + 1);

    setSelectedId(project.id);

    setProjectSearch("");

    setProjectRiskFilter("ALL");

    setProjectStateFilter("ALL");

    setCreationMessage(`Project ${project.project_id} created successfully.`);

    setProjectCreateOpen(false);

    window.location.hash = "#/projects";

    // Merge the newly created record immediately; a subsequent Refresh re-queries the API.

  }



  function handleProjectUpdated(project: Project): void {

    setProjects((previous) => previous.map((item) => item.id === project.id ? project : item));

    setSelectedId(project.id);

    setCreationMessage(`Project ${project.project_id} updated successfully.`);

    setProjectEditing(null);

  }



  async function handleRefresh(): Promise<void> {

    await loadProjects();

    setHistoryRevision((revision) => revision + 1);

  }



  async function handlePredictionSaved(): Promise<void> {

    // A saved prediction changes the latest risk shown in the project list.

    // The history request is triggered without clearing the existing form.

    await loadProjects();

    setHistoryRevision((revision) => revision + 1);

  }



  const selectedProject =

    projects.find((project) => project.id === selectedId) ?? null;

  const latestPrediction = selectedProject?.latest_prediction ?? null;

  const hasCurrentHistory =

    selectedId !== null && historyForId === selectedId;

  const currentHistory = hasCurrentHistory ? history : [];

  const latestHistory = currentHistory[0] ?? null;

  const snapshot = latestHistory?.input_snapshot ?? null;

  // A newly imported Bhoomi Rashi project has no prediction history yet.

  // Seed its first prediction form with only the verified project fields.

  // PredictionForm leaves every other required model input empty for review.

  const predictionFormSnapshot: Record<string, unknown> | null = selectedProject

    ? snapshot ?? {

        project_type: selectedProject.project_type ?? "",

        state: selectedProject.state ?? "",

        district: selectedProject.district ?? "",

        implementing_agency: selectedProject.implementing_agency ?? "",

        current_stage: selectedProject.current_stage ?? "",

        total_land_area: selectedProject.total_land_area ?? "",

        land_acquisition_percentage:

          selectedProject.total_land_area != null &&

          selectedProject.acquired_land_area != null &&

          Number(selectedProject.total_land_area) > 0

            ? Math.min(

                100,

                Math.max(

                  0,

                  (Number(selectedProject.acquired_land_area) /

                    Number(selectedProject.total_land_area)) *

                    100,

                ),

              )

            : "",

      }

    : null;



  const highRiskCount = projects.filter(

    (project) => project.latest_prediction?.risk_level?.toUpperCase() === "HIGH",

  ).length;

  const predictedCount = projects.filter(

    (project) => project.latest_prediction !== null,

  ).length;



  const normalizedActiveProjectSearch = activeProjectSearch.trim().toLocaleLowerCase();

  const activeProjectOptions = projects.filter((project) =>

    project.id === selectedId ||

    normalizedActiveProjectSearch.length === 0 ||

    [project.project_id, project.project_name, project.state, project.district]

      .some((value) => (value ?? "").toLocaleLowerCase().includes(normalizedActiveProjectSearch)),

  );



  // Offer every Indian state and union territory, including locations with no projects yet.

  const availableProjectStates = [...STATES, ...UNION_TERRITORIES];



  const normalizedProjectSearch = projectSearch.trim().toLocaleLowerCase();

  const filteredProjects = projects.filter((project) => {

    const matchesSearch =

      normalizedProjectSearch.length === 0 ||

      [

        project.project_id,

        project.project_name,

        project.district,

        project.state,

        project.implementing_agency,

      ].some((value) =>

        (value ?? "").toLocaleLowerCase().includes(normalizedProjectSearch),

      );



    const projectRisk =

      project.latest_prediction?.risk_level?.toUpperCase() ?? "NOT PREDICTED";



    return (

      matchesSearch &&

      (projectRiskFilter === "ALL" || projectRisk === projectRiskFilter) &&

      (projectStateFilter === "ALL" || project.state === projectStateFilter)

    );

  });

  const projectFiltersActive =

    projectSearch.trim().length > 0 ||

    projectRiskFilter !== "ALL" ||

    projectStateFilter !== "ALL";



  // Derived, read-only notices. These are not persisted or pushed notifications.

  const dashboardNotices: string[] = [];

  if (projectError) dashboardNotices.push(`Project API: ${projectError}`);

  if (historyError && selectedProject) dashboardNotices.push(`Prediction history: ${historyError}`);

  const highOrCritical = projects.filter((project) =>

    ["HIGH", "CRITICAL"].includes(project.latest_prediction?.risk_level?.toUpperCase() ?? ""),

  );

  if (highOrCritical.length) dashboardNotices.push(`${highOrCritical.length} loaded project(s) have a latest HIGH/CRITICAL model classification.`);

  if (totalProjects > projects.length && !projectError) dashboardNotices.push(`Only ${projects.length} of ${totalProjects} projects are loaded; notices cover only loaded data.`);



  const landTotal = Number(selectedProject?.total_land_area);

  const landAcquired = Number(selectedProject?.acquired_land_area);

  const landProgress =

    selectedProject?.total_land_area != null &&

    selectedProject.acquired_land_area != null &&

    Number.isFinite(landTotal) &&

    Number.isFinite(landAcquired) &&

    landTotal > 0

      ? Math.min(100, Math.max(0, (landAcquired / landTotal) * 100))

      : null;



  return (

    <div className={`app-shell gov-skin ${assistantOpen ? "assistant-visible" : ""} ${compactCards ? "compact-cards" : ""} ${reduceMotion ? "reduced-motion" : ""}`}>

      <aside className="sidebar" aria-label="Student project navigation">

        <div className="tricolor-top-wave" aria-hidden="true" />

        <div className="brand">

          <a className="brand-icon land-photo" href={LAND_PHOTO_CREDIT}

            target="_blank" rel="noopener noreferrer"

            title="Agricultural fields photograph by DP Singh Bhullar · CC BY-SA 4.0">

            <img src={LAND_PHOTO} alt="Aerial photograph of Indian agricultural land"

              loading="eager" onError={(event) => {

                event.currentTarget.style.display = "none";

              }}/>

            <span className="land-logo-fallback" aria-hidden="true">LA</span>

          </a>

          <div>

            <strong>Land Acquisition AI</strong>

            <span>Independent student prototype</span>

          </div>

        </div>

        <div className="nav-label">WORKSPACE</div>

        <Chakra className="sidebar-chakra" />

        <nav className="workspace-navigation" aria-label="Main navigation">

          {PAGE_NAV.map((item) => (

            <a

              key={item.page}

              href={`#/${item.page}`}

              className={`nav-item ${page === item.page ? "active" : ""}`}

              aria-current={page === item.page ? "page" : undefined}

              title={item.description}

            >

              <NavIcon page={item.page} />

              <span>{item.label}</span>

            </a>

          ))}

        </nav>

        <div className="sidebar-green-decor" aria-hidden="true" />

        <SidebarLandscape />

        <div className="sidebar-footer">

          <span className="footer-label"><span className="status-dot" /> Student prototype · Not a government portal</span>

          <a href={LAND_PHOTO_CREDIT} target="_blank" rel="noopener noreferrer">

            Land image: DP Singh Bhullar · CC BY-SA 4.0

          </a>

          <a href="https://commons.wikimedia.org/wiki/File:Official_Photograph_of_Prime_Minister_Narendra_Modi_Portrait.png"

             target="_blank" rel="noopener noreferrer">Portrait: PMO · GODL-India</a>

          <a href="https://commons.wikimedia.org/wiki/File:Emblem_of_India.svg"

             target="_blank" rel="noopener noreferrer">Emblem artwork source</a>

        </div>

      </aside>



      <main className="main-content">

        <section className="gov-masthead" aria-label="Platform identity and photo credit">

          <div className="gov-accent" aria-hidden="true" />

          <div className="gov-masthead-inner">

            <div className="gov-civic-mark" role="img"

              aria-label="Reference of Indian national emblem and Bharat text; independent student prototype">

              <img

                className="lion-emblem"

                src="https://commons.wikimedia.org/wiki/Special:FilePath/Emblem_of_India.svg?width=120"

                alt="Reference illustration of the Indian national emblem"

                loading="eager"

                onError={(event) => {

                  // Keep the dashboard usable if the external image cannot load.

                  event.currentTarget.style.display = "none";

                  const fallback = event.currentTarget.parentElement?.querySelector<SVGSVGElement>(".emblem-fallback");

                  if (fallback) fallback.style.display = "block";

                }}

              />

              <Chakra className="masthead-chakra emblem-fallback" />

              <span lang="hi">भारत</span>

            </div>

            <div className="gov-masthead-title">

              <span className="gov-kicker">Civic technology · Research demonstration</span>

              <strong>Land Acquisition Intelligence</strong>

              <span>Predictive analytics &amp; project monitoring</span>

            </div>

            {!hidePortrait && <div className="gov-photo-reference">

              <a

                className="gov-photo-source"

                href="https://commons.wikimedia.org/wiki/File:Official_Photograph_of_Prime_Minister_Narendra_Modi_Portrait.png"

                target="_blank"

                rel="noopener noreferrer"

                aria-label="Source of the reference photograph of Narendra Modi (not an endorsement of this student project)"

              >

                <img

                  src="https://commons.wikimedia.org/wiki/Special:FilePath/Official_Photograph_of_Prime_Minister_Narendra_Modi_Portrait.png"

                  alt="Reference photograph of Narendra Modi"

                  loading="lazy"

                  onError={(event) => {

                    event.currentTarget.style.display = "none";

                  }}

                />



              </a>

            </div>}

          </div>



        </section>

        <header className="topbar">

          {page !== "overview" && (

            <div>

              <div className="eyebrow">LAND ACQUISITION INTELLIGENCE</div>

              <h1>{PAGE_NAV.find((item) => item.page === page)?.label ?? "Projects"}</h1>

              <p>{PAGE_NAV.find((item) => item.page === page)?.description}</p>

            </div>

          )}

          <div className="topbar-actions">

            {projects.length > 0 && (

              <label className="global-project-switch">

                <span>Active project</span>

                <input

                  type="search"

                  aria-label="Search active projects"

                  placeholder="Search project or state"

                  value={activeProjectSearch}

                  onChange={(event) => setActiveProjectSearch(event.target.value)}

                />

                <select

                  aria-label="Select active project"

                  value={selectedId ?? ""}

                  onChange={(event) => setSelectedId(Number(event.target.value))}

                >

                  {activeProjectOptions.map((project) => (

                    <option key={project.id} value={project.id}>

                      {project.project_id} - {project.project_name.slice(0, 90)}

                    </option>

                  ))}

                </select>

              </label>

            )}

            <button

              type="button"

              className="refresh-button"

              onClick={() => void handleRefresh()}

              disabled={loadingProjects}

            >

              {loadingProjects ? "Refreshing..." : "↻ Refresh"}

            </button>

            <div className="header-utilities" aria-label="Account and notifications">

              <a href="#/account" className="utility-button" title="Account information" aria-label="Open account information">

                <svg className="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>Account</span>

              </a>

              <button type="button" className="utility-button notification-toggle"

                onClick={() => setNotificationsOpen((value) => !value)}

                aria-expanded={notificationsOpen} aria-controls="dashboard-notifications" title="Dashboard notices">

                <svg className="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span>Notifications</span>

                {dashboardNotices.length > 0 && <b className="notice-count">{dashboardNotices.length}</b>}

              </button>

              <button type="button" className="utility-button utility-signout" disabled

                title="Sign out requires authentication, which is not configured in this prototype">

                <svg className="utility-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M10 4H4v16h6M14 8l5 4-5 4m5-4H9"/></svg><span>Sign out</span>

              </button>

              {notificationsOpen && (

                <section id="dashboard-notifications" className="notification-popover" aria-label="Dashboard notices">

                  <div className="notification-heading"><strong>Dashboard notices</strong>

                    <button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications">×</button>

                  </div>

                  <p>Live, read-only checks for loaded data. Not a push-notification service.</p>

                  {dashboardNotices.length ? <ul>{dashboardNotices.map((notice, index) => <li key={`${index}-${notice}`}>{notice}</li>)}</ul>

                    : <p role="status">No notices detected in currently loaded data.</p>}

                </section>

              )}

            </div>

          </div>

        </header>







        {projectError && (

          <div className="error-box" role="alert">

            Projects API error: {projectError}

          </div>

        )}



        {loadingProjects && projects.length === 0 && page !== "settings" && page !== "account" ? (

          <p className="loading">Loading projects...</p>

        ) : (

          <>

            {page === "overview" && (

              <>

            <section className="stats-grid" aria-label="Project overview">

              <div className="stat-card stat-card-projects">

                <div className="stat-card-icon"><StatIcon type="projects" /></div>

                <span>Total Projects</span>

                <strong>{formatNumber(totalProjects, 0)}</strong>

                <small>All projects reported by the API</small>

              </div>

              <div className="stat-card stat-card-risk">

                <div className="stat-card-icon"><StatIcon type="risk" /></div>

                <span>High-Risk Projects</span>

                <strong className="danger-text">

                  {formatNumber(highRiskCount, 0)}

                </strong>

                <small>Among {projects.length} loaded projects</small>

              </div>

              <div className="stat-card stat-card-predicted">

                <div className="stat-card-icon"><StatIcon type="predicted" /></div>

                <span>Projects Predicted</span>

                <strong>{formatNumber(predictedCount, 0)}</strong>

                <small>Among loaded projects</small>

              </div>

              <div className="stat-card stat-card-selected">

                <div className="stat-card-icon"><StatIcon type="selected" /></div>

                <span>Selected Project</span>

                <strong>{selectedProject?.project_id ?? "—"}</strong>

                <small>Current selection</small>

              </div>

            </section>



            {/* Portfolio distribution uses only loaded projects and saved predictions. */}

            <section

              className="panel history-panel"

              aria-label="Portfolio risk analytics"

            >

              <PortfolioAnalyticsPanel

                projects={projects}

                totalProjects={totalProjects}

              />

            </section>



            {/* Latest saved predictions, scoped to the projects loaded from the API. */}

            <section

              className="panel history-panel"

              aria-label="High-risk project prioritization"

            >

              <HighRiskProjectsPanel

                projects={projects}

                onSelectProject={selectProject}

              />

            </section>



            {/* Read-only, browser-calculated review notices. */}

            <section

              className="panel history-panel"

              aria-label="Review alerts and suggested checks"

            >

              <RiskReviewAlertsPanel

                projects={projects}

                onSelectProject={selectProject}

              />

            </section>



              </>

            )}



            {page === "projects" && (

            <div className="content-grid">

              <section className="panel" aria-label="Projects">

                <div className="panel-heading">

                  <div>

                    <h2>Projects</h2>

                    <p>Select a project to see its intelligence.</p>

                  </div>

                  <div className="project-heading-actions">

                    <span className="count-badge">{projects.length}</span>

                    <button type="button" className="add-project-launch" onClick={() => {

                      setCreationMessage("");

                      setProjectCreateOpen(true);

                    }}>+ Add Project</button>

                  </div>

                </div>

                {creationMessage && <div className="add-project-success" role="status">{creationMessage}</div>}



                <div

                  className="project-filter-grid"

                  role="group"

                  aria-label="Filter loaded projects"

                >

                  <label>

                    Search

                    <input

                      type="search"

                      value={projectSearch}

                      onChange={(event) => setProjectSearch(event.target.value)}

                      placeholder="ID, name, district..."

                    />

                  </label>

                  <label>

                    Risk

                    <select

                      value={projectRiskFilter}

                      onChange={(event) => setProjectRiskFilter(event.target.value)}

                    >

                      <option value="ALL">All risks</option>

                      <option value="LOW">Low</option>

                      <option value="MEDIUM">Medium</option>

                      <option value="HIGH">High</option>

                      <option value="CRITICAL">Critical</option>

                      <option value="NOT PREDICTED">Not predicted</option>

                    </select>

                  </label>

                  <label>

                    State

                    <select

                      value={projectStateFilter}

                      onChange={(event) => setProjectStateFilter(event.target.value)}

                    >

                      <option value="ALL">All states</option>

                      {availableProjectStates.map((state) => (

                        <option key={state} value={state}>

                          {state}

                        </option>

                      ))}

                    </select>

                  </label>

                </div>



                <div className="project-filter-summary" aria-live="polite">

                  <span>

                    Showing {Math.min(filteredProjects.length, 100)} of {filteredProjects.length} matching projects

                  </span>

                  <button

                    type="button"

                    className="project-filter-clear"

                    disabled={!projectFiltersActive}

                    onClick={() => {

                      setProjectSearch("");

                      setProjectRiskFilter("ALL");

                      setProjectStateFilter("ALL");

                    }}

                  >

                    Clear filters

                  </button>

                </div>



                {totalProjects > projects.length && (

                  <p className="project-filter-notice">

                    Filters cover only the {projects.length} projects loaded from the API,

                    not all {totalProjects} projects in the database.

                  </p>

                )}



                {projects.length === 0 ? (

                  <p className="empty-state">No projects were returned.</p>

                ) : filteredProjects.length === 0 ? (

                  <p className="empty-state">

                    No loaded projects match these filters. Clear filters to show all.

                  </p>

                ) : (

                  <div className="project-list">

                    {filteredProjects.slice(0, 100).map((project) => (

                      <button

                        type="button"

                        key={project.id}

                        className={`project-card ${selectedId === project.id ? "selected" : ""}`}

                        onClick={() => setSelectedId(project.id)}

                        aria-pressed={selectedId === project.id}

                      >

                        <div className="project-card-top">

                          <span className="project-code">{project.project_id}</span>

                          <span

                            className={`risk-badge ${riskClass(project.latest_prediction?.risk_level)}`}

                          >

                            {project.latest_prediction?.risk_level ?? "NOT PREDICTED"}

                          </span>

                        </div>

                        <strong>{project.project_name}</strong>

                        <small>

                          {project.district}, {project.state}

                        </small>

                        <div className="project-card-bottom">

                          <span>{project.current_stage}</span>

                          <b>

                            {project.latest_prediction

                              ? `${formatNumber(project.latest_prediction.risk_score)}/100`

                              : "—"}

                          </b>

                        </div>

                      </button>

                    ))}

                  </div>

                )}

              </section>



              <section className="panel detail-panel" aria-label="Project intelligence">

                <div className="panel-heading">

                  <div>

                    <h2>Project Intelligence</h2>

                    <p>Latest saved prediction and land progress</p>

                  </div>

                </div>



                {!selectedProject ? (

                  <p className="empty-state">Select a project to see details.</p>

                ) : (

                  <>

                    <div className="project-edit-toolbar">

                      <button type="button" className="add-project-launch" onClick={() => {

                        setCreationMessage("");

                        setProjectEditing(selectedProject);

                      }}>✎ Edit project</button>

                    </div>

                    <div className="detail-title">

                      <span>{selectedProject.project_id}</span>

                      <h2>{selectedProject.project_name}</h2>

                      <p>{selectedProject.implementing_agency}</p>

                    </div>

                    <div className="risk-overview">

                      <div className="risk-number">

                        {latestPrediction

                          ? formatNumber(latestPrediction.risk_score)

                          : "—"}

                        <span>/100</span>

                      </div>

                      <div>

                        <span

                          className={`risk-badge ${riskClass(latestPrediction?.risk_level)}`}

                        >

                          {latestPrediction?.risk_level ?? "NOT PREDICTED"}

                        </span>

                        <p>Latest model risk score</p>

                      </div>

                    </div>

                    <div className="detail-metrics">

                      <div>

                        <span>Delay Probability</span>

                        <strong>

                          {latestPrediction

                            ? `${formatNumber(latestPrediction.delay_probability * 100)}%`

                            : "—"}

                        </strong>

                      </div>

                      <div>

                        <span>Expected Delay</span>

                        <strong>

                          {latestPrediction

                            ? `${formatNumber(latestPrediction.predicted_delay_days, 0)} days`

                            : "—"}

                        </strong>

                      </div>

                      <div>

                        <span>Current Stage</span>

                        <strong>{selectedProject.current_stage}</strong>

                      </div>

                      <div>

                        <span>District</span>

                        <strong>{selectedProject.district}</strong>

                      </div>

                    </div>

                    <h3>Land Acquisition Progress</h3>

                    {landProgress === null ? (

                      <p className="empty-state">Land progress data unavailable.</p>

                    ) : (

                      <>

                        <div className="progress-label">

                          <span>Acquired Land</span>

                          <strong>{formatNumber(landProgress)}%</strong>

                        </div>

                        <div

                          className="progress-track"

                          role="progressbar"

                          aria-label="Land acquisition progress"

                          aria-valuenow={landProgress}

                          aria-valuemin={0}

                          aria-valuemax={100}

                        >

                          <div

                            className="progress-fill"

                            style={{ width: `${landProgress}%` }}

                          />

                        </div>

                      </>

                    )}

                    <div className="land-details">

                      <div>

                        Total Land: <b>{formatNumber(selectedProject.total_land_area)} ha</b>

                      </div>

                      <div>

                        Remaining: <b>{formatNumber(selectedProject.remaining_land_area)} ha</b>

                      </div>

                    </div>

                  </>

                )}

              </section>

            </div>

            )}



            {page === "predictions" && !selectedProject && (

              <p className="empty-state">Choose an active project using the selector above or visit Projects.</p>

            )}

            {page === "predictions" && selectedProject && (

              <section className="panel history-panel" aria-label="Run new prediction">

                {!hasCurrentHistory && loadingHistory ? (

                  <p className="loading">Loading saved prediction inputs...</p>

                ) : predictionFormSnapshot ? (

                  <PredictionForm

                    key={selectedProject.id}

                    projectId={selectedProject.id}

                    projectName={selectedProject.project_name}

                    snapshot={predictionFormSnapshot}

                    onPredictionSaved={handlePredictionSaved}

                  />

                ) : (

                  <div>

                    <h2>Run New ML Prediction</h2>

                    {historyError ? (

                      <div className="error-box" role="alert">{historyError}</div>

                    ) : (

                      <p className="empty-state">Project inputs could not be loaded.</p>

                    )}

                  </div>

                )}

              </section>

            )}



            {page === "scenarios" && selectedProject && (

              <section className="panel history-panel" aria-label="What-if simulator">

                {!hasCurrentHistory && loadingHistory ? (

                  <p className="loading">Loading simulation baseline...</p>

                ) : snapshot && latestHistory ? (

                  <WhatIfSimulator

                    key={`${selectedProject.id}-${latestHistory.prediction_id}`}

                    projectId={selectedProject.id}

                    projectName={selectedProject.project_name}

                    sourcePredictionId={latestHistory.prediction_id}

                    snapshot={snapshot}

                  />

                ) : (

                  <div>

                    <h2>What-If Simulator</h2>

                    <p className="empty-state">

                      Simulation requires a saved prediction and input snapshot.

                    </p>

                  </div>

                )}

              </section>

            )}



            {/* ============================================================

                INTERVENTION SCENARIO ENGINE

            ============================================================ */}



            {page === "scenarios" && selectedProject && (

              <section

                className="panel history-panel"

                aria-label="Intervention scenario engine"

              >

                {!hasCurrentHistory && loadingHistory ? (

                  <p className="loading">Loading intervention baseline...</p>

                ) : snapshot && latestHistory ? (

                  <InterventionPanel

                    key={`${selectedProject.id}-${latestHistory.prediction_id}`}

                    projectId={selectedProject.id}

                    projectName={selectedProject.project_name}

                    sourcePredictionId={latestHistory.prediction_id}

                  />

                ) : (

                  <div>

                    <h2>Intervention Scenario Engine</h2>

                    {historyError ? (

                      <div className="error-box" role="alert">

                        Unable to load intervention baseline: {historyError}

                      </div>

                    ) : (

                      <p className="empty-state">

                        Generate scenarios after saving a prediction with a valid input snapshot.

                      </p>

                    )}

                  </div>

                )}

              </section>

            )}

            {page === "scenarios" && !selectedProject && (

              <p className="empty-state">Select a project to run scenarios.</p>

            )}



            {page === "insights" && (

              <nav className="section-tabs" aria-label="Insights views">

                {INSIGHT_TABS.map((item) => (

                  <a key={item.tab} href={`#/insights/${item.tab}`}

                    className={`section-tab ${insightTab === item.tab ? "active" : ""}`}

                    aria-current={insightTab === item.tab ? "page" : undefined}>

                    {item.label}

                  </a>

                ))}

              </nav>

            )}

            {/* PROJECT RISK TREND ANALYSIS */}



{page === "insights" && insightTab === "trend" && selectedProject && (

  <section

    className="panel history-panel"

    aria-label="Project risk trend analysis"

  >

    {!hasCurrentHistory && loadingHistory ? (

      <p className="loading">

        Loading project risk history...

      </p>

    ) : historyError ? (

      <div className="error-box" role="alert">

        {historyError}

      </div>

    ) : (

      <ProjectRiskTrendPanel

        key={selectedProject.id}

        projectName={selectedProject.project_name}

        history={currentHistory}

        totalPredictions={

          hasCurrentHistory ? totalPredictions : 0

        }

      />

    )}

  </section>

)}

{/* PREDICTION-TO-PREDICTION COMPARISON */}



{page === "insights" && insightTab === "comparison" && selectedProject && (

  <section

    className="panel history-panel"

    aria-label="Prediction comparison"

  >

    {!hasCurrentHistory && loadingHistory ? (

      <p className="loading">

        Loading prediction comparison...

      </p>

    ) : historyError ? (

      <div className="error-box" role="alert">

        {historyError}

      </div>

    ) : (

      <PredictionComparisonPanel

        key={selectedProject.id}

        projectName={selectedProject.project_name}

        history={currentHistory}

        totalPredictions={

          hasCurrentHistory ? totalPredictions : 0

        }

      />

    )}

  </section>

)}



            {/* ============================================================

                UNIFIED STAGE INTELLIGENCE

                Distinguish predictions, manually recorded stage events,

                rules-based findings, and prediction history.

            ============================================================ */}

            {page === "stages" && selectedProject && (

              <section

                className="panel history-panel unified-stage-panel"

                aria-label="Unified stage intelligence"

              >

                <div className="unified-stage-header">

                  <div>

                    <span className="simulation-card-label">

                      STAGE INTELLIGENCE CENTER

                    </span>

                    <h2>Unified Stage Intelligence</h2>

                    <p>Project: {selectedProject.project_name}</p>

                  </div>

                  <span className="count-badge">{selectedProject.project_id}</span>

                </div>







                <nav className="section-tabs" aria-label="Stage intelligence views">

                  {STAGE_TABS.map((item) => (

                    <a key={item.tab} href={`#/stages/${item.tab}`}

                      className={`section-tab ${stageTab === item.tab ? "active" : ""}`}

                      aria-current={stageTab === item.tab ? "page" : undefined}>

                      {item.label}

                    </a>

                  ))}

                </nav>



                {/* SOURCE 1 — STAGE-DELAY MODEL */}

                {stageTab === "model" && (

                <div className="unified-stage-block">

                  <div className="unified-stage-block-header">

                    <span className="stage-source-tag model-source">

                      SOURCE 01 · ML MODEL

                    </span>

                    <h3>Stage Delay Prediction</h3>

                    <p>

                      Enter the stage-specific model inputs to run Model 2.

                      A prediction is not saved as an actual stage event.

                    </p>

                  </div>

                  <StageDelayPanel

                    key={selectedProject.id}

                    projectName={selectedProject.project_name}

                  />

                </div>

                )}



                {/* SOURCE 2 — MANUALLY RECORDED STAGE EVENTS */}

                {stageTab === "records" && (

                <div className="unified-stage-block">

                  <div className="unified-stage-block-header">

                    <span className="stage-source-tag record-source">

                      SOURCE 02 · DATABASE RECORDS

                    </span>

                    <h3>Recorded Stage Events</h3>

                    <p>

                      Review or enter a stage status, progress, and documented dates.

                      Leave unknown dates empty; saving writes to PostgreSQL.

                    </p>

                  </div>

                  <StageEventsPanel

                    key={selectedProject.id}

                    projectId={selectedProject.id}

                    projectName={selectedProject.project_name}

                    onEventSaved={() =>

                      setStageDataRevision((previous) => previous + 1)

                    }

                  />

                </div>

                )}



                {/* DATA QUALITY — READ-ONLY STAGE READINESS */}

                {stageTab === "readiness" && (

                <div className="unified-stage-block">

                  <div className="unified-stage-block-header">

                    <span className="stage-source-tag record-source">

                      DATA QUALITY · RECORDED INFORMATION

                    </span>

                    <h3>Stage Data Readiness</h3>

                    <p>

                      Review date coverage and record-quality checks before

                      interpreting bottleneck findings. These checks do not

                      independently verify the underlying records.

                    </p>

                  </div>

                  <StageReadinessPanel

                    key={selectedProject.id}

                    projectId={selectedProject.id}

                    refreshToken={stageDataRevision}

                  />

                </div>

                )}



                {/* SOURCE 3 — READ-ONLY RULES-BASED ANALYSIS */}

                {stageTab === "bottlenecks" && (

                <div className="unified-stage-block">

                  <div className="unified-stage-block-header">

                    <span className="stage-source-tag analysis-source">

                      SOURCE 03 · RULES-BASED ANALYSIS

                    </span>

                    <h3>Recorded Bottleneck Conditions</h3>

                    <p>

                      Compare the latest recorded stage statuses and dates.

                      The analysis refreshes after a successful stage-event save.

                    </p>

                  </div>

                  <StageBottlenecksPanel

                    key={selectedProject.id}

                    projectId={selectedProject.id}

                    projectName={selectedProject.project_name}

                    refreshToken={stageDataRevision}

                  />

                </div>

                )}



                {/* ADDITIONAL CONTEXT — SAVED MODEL PREDICTIONS */}

                {stageTab === "timeline" && hasCurrentHistory && currentHistory.length > 0 && (

                  <div className="unified-stage-block">

                    <div className="unified-stage-block-header">

                      <span className="stage-source-tag history-source">

                        ADDITIONAL CONTEXT · PREDICTION HISTORY

                      </span>

                      <h3>Prediction Observation Timeline</h3>

                      <p>

                        These timestamps describe saved predictions, not actual

                        stage start dates or completion dates.

                      </p>

                    </div>

                    <StageTimeline

                      key={selectedProject.id}

                      projectName={selectedProject.project_name}

                      history={currentHistory}

                    />

                  </div>

                )}

                {stageTab === "timeline" && currentHistory.length === 0 && (

                  <p className="empty-state">No saved prediction observations are available for the timeline.</p>

                )}

              </section>

            )}

            {page === "documents" && selectedProject && (

  <section

    className="panel history-panel"

    aria-label="Document intelligence"

  >

    <DocumentIntelligencePanel

      key={selectedProject.id}

      projectId={selectedProject.id}

      projectName={selectedProject.project_name}

    />

  </section>

)}



{page === "documents" && !selectedProject && (

  <p className="empty-state">

    Select an active project before analysing documents.

  </p>

)}



            {/* GIS PROJECT INTELLIGENCE */}

            {page === "gis" && (

              <GisPage

                projects={projects}

                selectedProject={selectedProject}

                onSelectProject={(project) => {

                  setSelectedId(project.id);

                }}

              />

            )}



            {/* MODEL MONITORING AND DATA QUALITY */}

            {page === "insights" && insightTab === "monitoring" && selectedProject && (

              <section

                className="panel history-panel"

                aria-label="Model monitoring and data quality"

              >

                {!hasCurrentHistory && loadingHistory ? (

                  <p className="loading">Loading monitoring information...</p>

                ) : historyError ? (

                  <div className="error-box" role="alert">{historyError}</div>

                ) : (

                  <ModelMonitoringPanel

                    key={selectedProject.id}

                    projectName={selectedProject.project_name}

                    history={currentHistory}

                    totalPredictions={hasCurrentHistory ? totalPredictions : 0}

                  />

                )}

              </section>

            )}



            {page === "insights" && insightTab === "history" && (

            <section className="panel history-panel" aria-label="Prediction history">

              <div className="panel-heading">

                <div>

                  <h2>Prediction History</h2>

                  <p>Saved predictions and model explanation factors.</p>

                </div>

                <span className="count-badge">

                  {hasCurrentHistory ? totalPredictions : 0}

                </span>

              </div>



              {!hasCurrentHistory && loadingHistory ? (

                <p className="loading">Loading history...</p>

              ) : historyError ? (

                <div className="error-box" role="alert">{historyError}</div>

              ) : currentHistory.length === 0 ? (

                <p className="empty-state">No saved predictions for this project.</p>

              ) : (

                <>

                  {loadingHistory && <p className="loading">Refreshing history...</p>}

                  <div className="history-table-wrap">

                    <table>

                      <thead>

                        <tr>

                          <th>Prediction ID</th>

                          <th>Risk Score</th>

                          <th>Risk Level</th>

                          <th>Delay Days</th>

                          <th>Timestamp (API)</th>

                        </tr>

                      </thead>

                      <tbody>

                        {currentHistory.map((record) => (

                          <tr key={record.prediction_id}>

                            <td>#{record.prediction_id}</td>

                            <td>{formatNumber(record.risk_score)}</td>

                            <td>

                              <span className={`risk-badge ${riskClass(record.risk_level)}`}>

                                {record.risk_level}

                              </span>

                            </td>

                            <td>{formatNumber(record.predicted_delay_days, 0)}</td>

                            <td>{formatTimestamp(record.created_at)}</td>

                          </tr>

                        ))}

                      </tbody>

                    </table>

                  </div>



                  <h3>Latest Prediction — Risk Factors</h3>

                  {latestHistory && latestHistory.risk_factors.length > 0 ? (

                    <div className="factors-list">

                      {latestHistory.risk_factors.map((factor) => (

                        <div

                          className="factor-row"

                          key={`${latestHistory.prediction_id}-${factor.rank}`}

                        >

                          <div>

                            <strong>{factor.feature.replace(/_/g, " ")}</strong>

                            <small>Value: {factor.value ?? "—"}</small>

                          </div>

                          <span

                            className={

                              factor.contribution > 0

                                ? "factor-up"

                                : factor.contribution < 0

                                  ? "factor-down"

                                  : ""

                            }

                          >

                            {factor.contribution > 0

                              ? "↑ Increases model log-odds"

                              : factor.contribution < 0

                                ? "↓ Decreases model log-odds"

                                : "Neutral"}

                          </span>

                        </div>

                      ))}

                    </div>

                  ) : (

                    <p className="empty-state">No explanation factors were saved.</p>

                  )}

                  <p className="explanation-note">

                    Contributions are relative to the model's reference point and

                    measured in log-odds, not probability percentage points.

                  </p>

                </>

              )}

            </section>

            )}

            {page === "insights" && !selectedProject && (

              <p className="empty-state">Select a project to inspect its saved predictions.</p>

            )}

            {page === "stages" && !selectedProject && (

              <p className="empty-state">Select a project to inspect its stage records.</p>

            )}

            {page === "settings" && (

              <section className="panel utility-page" aria-label="Display settings">

                <h2>Settings</h2>

                <p>Display preferences for this browser session. Changes do not modify backend data.</p>

                <label><input type="checkbox" checked={compactCards} onChange={(event) => setCompactCards(event.target.checked)} /> Compact dashboard cards</label>

                <label><input type="checkbox" checked={reduceMotion} onChange={(event) => setReduceMotion(event.target.checked)} /> Reduce interface animations</label>

                <label><input type="checkbox" checked={hidePortrait} onChange={(event) => setHidePortrait(event.target.checked)} /> Hide header photograph</label>

              </section>

            )}

            {page === "account" && (

              <section className="panel utility-page" aria-label="Account status">

                <h2>Account</h2>

                <p>No authenticated account is connected in this frontend. We cannot display a user profile or perform a secure sign-out until authentication is implemented.</p>

                <dl><dt>Session</dt><dd>Not authenticated</dd><dt>Project context</dt><dd>{selectedProject ? `${selectedProject.project_id} — ${selectedProject.project_name}` : "No selected project"}</dd></dl>

                <p>The account icon is a navigation shortcut; it is not an identity verification control.</p>

              </section>

            )}

            {page === "reports" && (

              <>

                <section className="panel history-panel" aria-label="Portfolio CSV report">

                  <PortfolioExportPanel projects={projects} totalProjects={totalProjects} />

                </section>

                {selectedProject ? (

                  <section className="panel history-panel" aria-label="Stage evidence PDF report">

                    <StageEvidenceExport key={selectedProject.id}

                      projectId={selectedProject.id} projectName={selectedProject.project_name} />

                  </section>

                ) : (

                  <p className="empty-state">Select a project to export stage evidence.</p>

                )}

                <section className="panel history-panel" aria-label="Prediction comparison PDF report">

                  <h2>Prediction Comparison PDF</h2>

                  <p>Choose two predictions on the Compare tab to download their PDF report.</p>

                  <a href="#/insights/comparison" className="refresh-button report-link">

                    Open Prediction Comparison

                  </a>

                </section>

              </>

            )}

          </>

        )}

      </main>

      {projectCreateOpen && <AddProjectModal onClose={() => setProjectCreateOpen(false)} onCreated={handleProjectCreated} />}

      {projectEditing && <AddProjectModal

        onClose={() => setProjectEditing(null)}

        onCreated={handleProjectUpdated}

      />}

      <AssistantPanel open={assistantOpen} onOpen={() => setAssistantOpen(true)} onClose={() => setAssistantOpen(false)}

        projects={projects} totalProjects={totalProjects} selectedProject={selectedProject}

        history={currentHistory} projectError={projectError} historyError={historyError} />

    </div>

  );

}



export default App;
