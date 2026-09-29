import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import * as maptilersdk from "@maptiler/sdk";

import "@maptiler/sdk/dist/maptiler-sdk.css";
import "./ProjectMap.css";

import type {
  Project,
} from "../services/projectsApi";


// ============================================================
// TYPES
// ============================================================

interface ProjectMapProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject?: (project: Project) => void;
}


type GISProject = Project & {
  latitude?: number | string | null;
  longitude?: number | string | null;

  start_latitude?: number | string | null;
  start_longitude?: number | string | null;

  end_latitude?: number | string | null;
  end_longitude?: number | string | null;

  route_geometry?: unknown;
  route_geojson?: unknown;

  location_source?: string | null;
  location_accuracy?: string | null;
  geocode_confidence?: number | null;
  gis_status?: string | null;
};


type Coordinate = [number, number];


// ============================================================
// CONSTANTS
// ============================================================

const INDIA_CENTER: Coordinate = [
  78.9629,
  22.5937,
];


const PROJECT_SOURCE =
  "acquitwin-projects";

const SELECTED_SOURCE =
  "acquitwin-selected-project";

const ROUTE_SOURCE =
  "acquitwin-selected-route";

const ENDPOINT_SOURCE =
  "acquitwin-route-endpoints";


const LAYER_CLUSTERS =
  "acquitwin-clusters";

const LAYER_CLUSTER_COUNT =
  "acquitwin-cluster-count";

const LAYER_PROJECTS =
  "acquitwin-project-points";

const LAYER_PROJECT_LABELS =
  "acquitwin-project-labels";

const LAYER_SELECTED =
  "acquitwin-selected-ring";

const LAYER_ROUTE_REAL =
  "acquitwin-route-real";

const LAYER_ROUTE_APPROX =
  "acquitwin-route-approx";

const LAYER_ENDPOINTS =
  "acquitwin-endpoints";

const LAYER_ENDPOINT_LABELS =
  "acquitwin-endpoint-labels";


// ============================================================
// BASIC HELPERS
// ============================================================

function toNumber(
  value: unknown
): number | null {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return null;
  }

  return numeric;
}


function getCoordinate(
  latitude: unknown,
  longitude: unknown
): Coordinate | null {

  const lat =
    toNumber(latitude);

  const lng =
    toNumber(longitude);

  if (
    lat === null ||
    lng === null
  ) {
    return null;
  }

  if (
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  // GeoJSON uses:
  // [longitude, latitude]

  return [
    lng,
    lat,
  ];
}


function getProjectCoordinate(
  project: GISProject
): Coordinate | null {

  return getCoordinate(
    project.latitude,
    project.longitude
  );
}


function getStartCoordinate(
  project: GISProject
): Coordinate | null {

  return getCoordinate(
    project.start_latitude,
    project.start_longitude
  );
}


function getEndCoordinate(
  project: GISProject
): Coordinate | null {

  return getCoordinate(
    project.end_latitude,
    project.end_longitude
  );
}


// ============================================================
// PROJECT DATA HELPERS
// ============================================================

function getRiskLevel(
  project: GISProject
): string {

  const risk =
    project
      .latest_prediction
      ?.risk_level
      ?.trim()
      ?.toUpperCase();

  return risk || "UNKNOWN";
}


function formatProbability(
  value: unknown
): string {

  const numeric =
    toNumber(value);

  if (numeric === null) {
    return "Not recorded";
  }

  const percentage =
    numeric <= 1
      ? numeric * 100
      : numeric;

  return `${percentage.toFixed(2)}%`;
}


function formatLandProgress(
  project: GISProject
): string {

  const total =
    toNumber(
      project.total_land_area
    );

  const acquired =
    toNumber(
      project.acquired_land_area
    );

  if (
    total === null ||
    acquired === null ||
    total <= 0
  ) {
    return "Not recorded";
  }

  const percentage =
    Math.min(
      100,
      Math.max(
        0,
        (
          acquired /
          total
        ) * 100
      )
    );

  return `${percentage.toFixed(1)}%`;
}


function getSearchText(
  project: GISProject
): string {

  return [
    project.project_id,
    project.project_name,
    project.state,
    project.district,
    project.current_stage,
    getRiskLevel(project),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}


// ============================================================
// ROUTE GEOMETRY
// ============================================================

function readRouteCoordinates(
  project: GISProject
): Coordinate[] | null {

  const raw =
    project.route_geojson ??
    project.route_geometry;

  if (!raw) {
    return null;
  }

  let geometry: any =
    raw;

  // Backend may send JSON as a string.
  if (
    typeof geometry === "string"
  ) {

    try {

      geometry =
        JSON.parse(
          geometry
        );

    } catch {

      return null;
    }
  }


  // GeoJSON Feature
  if (
    geometry?.type ===
    "Feature"
  ) {
    geometry =
      geometry.geometry;
  }


  if (
    geometry?.type !==
    "LineString"
  ) {
    return null;
  }


  if (
    !Array.isArray(
      geometry.coordinates
    )
  ) {
    return null;
  }


  const result: Coordinate[] =
    [];


  for (
    const coordinate
    of geometry.coordinates
  ) {

    if (
      !Array.isArray(
        coordinate
      ) ||
      coordinate.length < 2
    ) {
      continue;
    }

    const lng =
      toNumber(
        coordinate[0]
      );

    const lat =
      toNumber(
        coordinate[1]
      );

    if (
      lng === null ||
      lat === null
    ) {
      continue;
    }

    result.push(
      [
        lng,
        lat,
      ]
    );
  }


  return result.length >= 2
    ? result
    : null;
}


// ============================================================
// EMPTY GEOJSON
// ============================================================

function emptyGeoJson() {

  return {
    type:
      "FeatureCollection",
    features: [],
  };
}


// ============================================================
// ALL PROJECTS GEOJSON
// ============================================================

function buildProjectsGeoJson(
  projects: GISProject[]
) {

  const features =
    projects
      .map(
        (
          project
        ) => {

          const coordinate =
            getProjectCoordinate(
              project
            );

          if (!coordinate) {
            return null;
          }

          return {
            type:
              "Feature",

            id:
              project.id,

            properties: {

              database_id:
                String(
                  project.id
                ),

              project_id:
                project.project_id,

              name:
                project.project_name,

              state:
                project.state ?? "",

              district:
                project.district ?? "",

              risk:
                getRiskLevel(
                  project
                ),

              accuracy:
                project
                  .location_accuracy
                ??
                "UNKNOWN",
            },

            geometry: {
              type:
                "Point",

              coordinates:
                coordinate,
            },
          };
        }
      )
      .filter(
        (
          feature
        ) =>
          feature !== null
      );


  return {
    type:
      "FeatureCollection",
    features,
  };
}


// ============================================================
// SELECTED PROJECT GEOJSON
// ============================================================

function buildSelectedGeoJson(
  project: GISProject | null
) {

  if (!project) {
    return emptyGeoJson();
  }


  const coordinate =
    getProjectCoordinate(
      project
    );


  if (!coordinate) {
    return emptyGeoJson();
  }


  return {
    type:
      "FeatureCollection",

    features: [
      {
        type:
          "Feature",

        properties: {
          project_id:
            project.project_id,
        },

        geometry: {
          type:
            "Point",

          coordinates:
            coordinate,
        },
      },
    ],
  };
}


// ============================================================
// START / END GEOJSON
// ============================================================

function buildEndpointsGeoJson(
  project: GISProject | null
) {

  if (!project) {
    return emptyGeoJson();
  }


  const features: any[] =
    [];


  const start =
    getStartCoordinate(
      project
    );


  const end =
    getEndCoordinate(
      project
    );


  if (start) {

    features.push(
      {
        type:
          "Feature",

        properties: {
          endpoint:
            "START",

          label:
            "START",
        },

        geometry: {
          type:
            "Point",

          coordinates:
            start,
        },
      }
    );
  }


  if (end) {

    features.push(
      {
        type:
          "Feature",

        properties: {
          endpoint:
            "END",

          label:
            "END",
        },

        geometry: {
          type:
            "Point",

          coordinates:
            end,
        },
      }
    );
  }


  return {
    type:
      "FeatureCollection",
    features,
  };
}


// ============================================================
// ROUTE GEOJSON
// ============================================================

function buildRouteGeoJson(
  project: GISProject | null
) {

  if (!project) {
    return emptyGeoJson();
  }


  // ----------------------------------------------------------
  // REAL ROUTE
  // ----------------------------------------------------------

  const realRoute =
    readRouteCoordinates(
      project
    );


  if (realRoute) {

    return {
      type:
        "FeatureCollection",

      features: [
        {
          type:
            "Feature",

          properties: {
            approximate:
              false,
          },

          geometry: {
            type:
              "LineString",

            coordinates:
              realRoute,
          },
        },
      ],
    };
  }


  // ----------------------------------------------------------
  // APPROXIMATE START -> END
  // ----------------------------------------------------------

  const start =
    getStartCoordinate(
      project
    );

  const end =
    getEndCoordinate(
      project
    );


  if (
    start &&
    end
  ) {

    return {
      type:
        "FeatureCollection",

      features: [
        {
          type:
            "Feature",

          properties: {
            approximate:
              true,
          },

          geometry: {
            type:
              "LineString",

            coordinates: [
              start,
              end,
            ],
          },
        },
      ],
    };
  }


  return emptyGeoJson();
}


// ============================================================
// SET GEOJSON SOURCE
// ============================================================

function setSourceData(
  map: maptilersdk.Map,
  sourceId: string,
  data: any
) {

  const source =
    map.getSource(
      sourceId
    ) as any;


  if (
    source &&
    typeof source.setData ===
      "function"
  ) {

    source.setData(
      data
    );
  }
}


// ============================================================
// CREATE / UPDATE MAP LAYERS
// ============================================================

function syncMapLayers(
  map: maptilersdk.Map,
  projects: GISProject[],
  selectedProject: GISProject | null
) {

  const projectsData =
    buildProjectsGeoJson(
      projects
    );


  // ==========================================================
  // PROJECT SOURCE
  // ==========================================================

  if (
    !map.getSource(
      PROJECT_SOURCE
    )
  ) {

    map.addSource(
      PROJECT_SOURCE,
      {
        type:
          "geojson",

        data:
          projectsData as any,

        cluster:
          true,

        clusterMaxZoom:
          10,

        clusterRadius:
          55,
      }
    );

  } else {

    setSourceData(
      map,
      PROJECT_SOURCE,
      projectsData
    );
  }


  // ==========================================================
  // CLUSTER CIRCLES
  // ==========================================================

  if (
    !map.getLayer(
      LAYER_CLUSTERS
    )
  ) {

    map.addLayer(
      {
        id:
          LAYER_CLUSTERS,

        type:
          "circle",

        source:
          PROJECT_SOURCE,

        filter: [
          "has",
          "point_count",
        ],

        paint: {

          "circle-color":
            "#123a63",

          "circle-opacity":
            0.92,

          "circle-stroke-color":
            "#ffffff",

          "circle-stroke-width":
            3,

          "circle-radius": [
            "step",

            [
              "get",
              "point_count",
            ],

            18,

            50,
            23,

            200,
            29,

            500,
            36,
          ],
        },
      } as any
    );
  }


  // ==========================================================
  // CLUSTER NUMBERS
  // ==========================================================

  if (
    !map.getLayer(
      LAYER_CLUSTER_COUNT
    )
  ) {

    map.addLayer(
      {
        id:
          LAYER_CLUSTER_COUNT,

        type:
          "symbol",

        source:
          PROJECT_SOURCE,

        filter: [
          "has",
          "point_count",
        ],

        layout: {

          "text-field":
            "{point_count_abbreviated}",

          "text-size":
            13,
        },

        paint: {

          "text-color":
            "#ffffff",
        },
      } as any
    );
  }


  // ==========================================================
  // INDIVIDUAL PROJECT MARKERS
  // ==========================================================

  if (
    !map.getLayer(
      LAYER_PROJECTS
    )
  ) {

    map.addLayer(
      {
        id:
          LAYER_PROJECTS,

        type:
          "circle",

        source:
          PROJECT_SOURCE,

        filter: [
          "!",
          [
            "has",
            "point_count",
          ],
        ],

        paint: {

          "circle-radius":
            8,

          "circle-color": [
            "match",

            [
              "get",
              "risk",
            ],

            "CRITICAL",
            "#9f1239",

            "HIGH",
            "#dc2626",

            "MEDIUM",
            "#f59e0b",

            "LOW",
            "#16a34a",

            "#2563eb",
          ],

          "circle-stroke-color":
            "#ffffff",

          "circle-stroke-width":
            2,

          "circle-opacity":
            0.95,
        },
      } as any
    );
  }


  // ==========================================================
  // PROJECT LABELS
  // ==========================================================

  if (
    !map.getLayer(
      LAYER_PROJECT_LABELS
    )
  ) {

    map.addLayer(
      {
        id:
          LAYER_PROJECT_LABELS,

        type:
          "symbol",

        source:
          PROJECT_SOURCE,

        minzoom:
          8,

        filter: [
          "!",
          [
            "has",
            "point_count",
          ],
        ],

        layout: {

          "text-field": [
            "get",
            "project_id",
          ],

          "text-size":
            10,

          "text-offset": [
            0,
            1.4,
          ],

          "text-anchor":
            "top",

          "text-allow-overlap":
            false,
        },

        paint: {

          "text-color":
            "#102a43",

          "text-halo-color":
            "#ffffff",

          "text-halo-width":
            2,
        },
      } as any
    );
  }


  // ==========================================================
  // SELECTED PROJECT
  // ==========================================================

  const selectedData =
    buildSelectedGeoJson(
      selectedProject
    );


  if (
    !map.getSource(
      SELECTED_SOURCE
    )
  ) {

    map.addSource(
      SELECTED_SOURCE,
      {
        type:
          "geojson",

        data:
          selectedData as any,
      }
    );

  } else {

    setSourceData(
      map,
      SELECTED_SOURCE,
      selectedData
    );
  }


  if (
    !map.getLayer(
      LAYER_SELECTED
    )
  ) {

    map.addLayer(
      {
        id:
          LAYER_SELECTED,

        type:
          "circle",

        source:
          SELECTED_SOURCE,

        paint: {

          "circle-radius":
            15,

          "circle-color":
            "rgba(255,255,255,0)",

          "circle-stroke-color":
            "#071b33",

          "circle-stroke-width":
            4,
        },
      } as any
    );
  }


  // ==========================================================
  // ROUTE
  // ==========================================================

  const routeData =
    buildRouteGeoJson(
      selectedProject
    );


  if (
    !map.getSource(
      ROUTE_SOURCE
    )
  ) {

    map.addSource(
      ROUTE_SOURCE,
      {
        type:
          "geojson",

        data:
          routeData as any,
      }
    );

  } else {

    setSourceData(
      map,
      ROUTE_SOURCE,
      routeData
    );
  }


  // REAL ROAD / CORRIDOR
  if (
    !map.getLayer(
      LAYER_ROUTE_REAL
    )
  ) {

    map.addLayer(
      {
        id:
          LAYER_ROUTE_REAL,

        type:
          "line",

        source:
          ROUTE_SOURCE,

        filter: [
          "==",
          [
            "get",
            "approximate",
          ],
          false,
        ],

        layout: {

          "line-cap":
            "round",

          "line-join":
            "round",
        },

        paint: {

          "line-color":
            "#16a34a",

          "line-width":
            7,

          "line-opacity":
            0.95,
        },
      } as any
    );
  }


  // APPROXIMATE STRAIGHT CONNECTION
  if (
    !map.getLayer(
      LAYER_ROUTE_APPROX
    )
  ) {

    map.addLayer(
      {
        id:
          LAYER_ROUTE_APPROX,

        type:
          "line",

        source:
          ROUTE_SOURCE,

        filter: [
          "==",
          [
            "get",
            "approximate",
          ],
          true,
        ],

        layout: {

          "line-cap":
            "round",

          "line-join":
            "round",
        },

        paint: {

          "line-color":
            "#f59e0b",

          "line-width":
            5,

          "line-dasharray": [
            2,
            2,
          ],

          "line-opacity":
            0.9,
        },
      } as any
    );
  }


  // ==========================================================
  // START / END
  // ==========================================================

  const endpointData =
    buildEndpointsGeoJson(
      selectedProject
    );


  if (
    !map.getSource(
      ENDPOINT_SOURCE
    )
  ) {

    map.addSource(
      ENDPOINT_SOURCE,
      {
        type:
          "geojson",

        data:
          endpointData as any,
      }
    );

  } else {

    setSourceData(
      map,
      ENDPOINT_SOURCE,
      endpointData
    );
  }


  if (
    !map.getLayer(
      LAYER_ENDPOINTS
    )
  ) {

    map.addLayer(
      {
        id:
          LAYER_ENDPOINTS,

        type:
          "circle",

        source:
          ENDPOINT_SOURCE,

        paint: {

          "circle-radius":
            10,

          "circle-color": [
            "match",

            [
              "get",
              "endpoint",
            ],

            "START",
            "#16a34a",

            "END",
            "#dc2626",

            "#2563eb",
          ],

          "circle-stroke-color":
            "#ffffff",

          "circle-stroke-width":
            3,
        },
      } as any
    );
  }


  if (
    !map.getLayer(
      LAYER_ENDPOINT_LABELS
    )
  ) {

    map.addLayer(
      {
        id:
          LAYER_ENDPOINT_LABELS,

        type:
          "symbol",

        source:
          ENDPOINT_SOURCE,

        layout: {

          "text-field": [
            "get",
            "label",
          ],

          "text-size":
            12,

          "text-offset": [
            0,
            1.6,
          ],

          "text-anchor":
            "top",
        },

        paint: {

          "text-color":
            "#102a43",

          "text-halo-color":
            "#ffffff",

          "text-halo-width":
            2,
        },
      } as any
    );
  }
}


// ============================================================
// FOCUS SELECTED PROJECT
// ============================================================

function focusProject(
  map: maptilersdk.Map,
  project: GISProject
) {

  const points: Coordinate[] =
    [];


  const route =
    readRouteCoordinates(
      project
    );


  if (route) {
    points.push(
      ...route
    );
  }


  const start =
    getStartCoordinate(
      project
    );


  if (start) {
    points.push(
      start
    );
  }


  const end =
    getEndCoordinate(
      project
    );


  if (end) {
    points.push(
      end
    );
  }


  // ----------------------------------------------------------
  // ROUTE / START-END AVAILABLE
  // ----------------------------------------------------------

  if (
    points.length >= 2
  ) {

    const bounds =
      new maptilersdk
        .LngLatBounds();


    for (
      const point
      of points
    ) {

      bounds.extend(
        point
      );
    }


    map.fitBounds(
      bounds,
      {
        padding:
          90,

        maxZoom:
          13,

        duration:
          900,
      }
    );

    return;
  }


  // ----------------------------------------------------------
  // ONLY PROJECT POINT
  // ----------------------------------------------------------

  const coordinate =
    getProjectCoordinate(
      project
    );


  if (coordinate) {

    map.flyTo(
      {
        center:
          coordinate,

        zoom:
          11,

        duration:
          900,
      }
    );
  }
}


// ============================================================
// COMPONENT
// ============================================================

export default function ProjectMap({
  projects,
  selectedProject,
  onSelectProject,
}: ProjectMapProps) {

  const mapContainerRef =
    useRef<HTMLDivElement | null>(
      null
    );


  const mapRef =
    useRef<maptilersdk.Map | null>(
      null
    );


  const projectsRef =
    useRef<GISProject[]>(
      []
    );


  const selectedRef =
    useRef<GISProject | null>(
      null
    );


  const selectCallbackRef =
    useRef<
      ProjectMapProps[
        "onSelectProject"
      ]
    >(
      onSelectProject
    );


  const is3DRef =
    useRef(false);


  const [
    mapReady,
    setMapReady,
  ] =
    useState(false);


  const [
    search,
    setSearch,
  ] =
    useState("");


  const [
    is3D,
    setIs3D,
  ] =
    useState(false);


  const [
    satellite,
    setSatellite,
  ] =
    useState(false);


  // IMPORTANT:
  // Keep casts simple.
  const gisProjects =
    projects as GISProject[];


  const gisSelected =
    selectedProject
      ? selectedProject as GISProject
      : null;


  projectsRef.current =
    gisProjects;


  selectedRef.current =
    gisSelected;


  selectCallbackRef.current =
    onSelectProject;


  // ==========================================================
  // COUNTS
  // ==========================================================

  const mappedCount =
    useMemo(
      () => {

        return gisProjects
          .filter(
            (
              project
            ) =>
              getProjectCoordinate(
                project
              ) !== null
          )
          .length;

      },
      [
        gisProjects,
      ]
    );


  const unresolvedCount =
    projects.length -
    mappedCount;


  // ==========================================================
  // SEARCH RESULTS
  // ==========================================================

  const searchResults =
    useMemo(
      () => {

        const term =
          search
            .trim()
            .toLowerCase();


        if (!term) {
          return [];
        }


        return gisProjects
          .filter(
            (
              project
            ) =>
              getSearchText(
                project
              ).includes(
                term
              )
          )
          .slice(
            0,
            15
          );

      },
      [
        search,
        gisProjects,
      ]
    );


  // ==========================================================
  // INITIALIZE MAP
  // ==========================================================

  useEffect(
    () => {

      const container =
        mapContainerRef.current;


      if (
        !container ||
        mapRef.current
      ) {
        return;
      }


      const key =
        import.meta.env
          .VITE_MAPTILER_KEY;


      if (!key) {

        console.error(
          "VITE_MAPTILER_KEY is missing."
        );

        return;
      }


      maptilersdk
        .config
        .apiKey =
        key;


      const map =
        new maptilersdk.Map(
          {
            container,

            style:
              maptilersdk
                .MapStyle
                .STREETS,

            center:
              INDIA_CENTER,

            zoom:
              4.2,

            minZoom:
              3,

            maxZoom:
              19,

            pitch:
              0,

            bearing:
              0,

            terrain:
              false,

            navigationControl:
              true,

            scaleControl:
              true,

            fullscreenControl:
              true,

            terrainControl:
              false,
          }
        );


      mapRef.current =
        map;


      // ======================================================
      // INITIAL LOAD
      // ======================================================

      map.on(
        "load",
        () => {

          syncMapLayers(
            map,
            projectsRef.current,
            selectedRef.current
          );


          setMapReady(
            true
          );


          // ==================================================
          // PROJECT CLICK
          // ==================================================

          map.on(
            "click",
            LAYER_PROJECTS,
            (
              event: any
            ) => {

              const feature =
                event
                  .features
                  ?.[0];


              if (!feature) {
                return;
              }


              const databaseId =
                String(
                  feature
                    .properties
                    ?.database_id
                );


              const project =
                projectsRef
                  .current
                  .find(
                    (
                      item
                    ) =>
                      String(
                        item.id
                      ) ===
                      databaseId
                  );


              if (!project) {
                return;
              }


              selectCallbackRef
                .current
                ?.(project);


              focusProject(
                map,
                project
              );
            }
          );


          // ==================================================
          // CLUSTER CLICK
          // ==================================================

          map.on(
            "click",
            LAYER_CLUSTERS,
            async (
              event: any
            ) => {

              const features =
                map
                  .queryRenderedFeatures(
                    event.point,
                    {
                      layers: [
                        LAYER_CLUSTERS,
                      ],
                    }
                  );


              const feature =
                features[0];


              if (!feature) {
                return;
              }


              const clusterId =
                Number(
                  feature
                    .properties
                    ?.cluster_id
                );


              if (
                !Number.isFinite(
                  clusterId
                )
              ) {
                return;
              }


              const source =
                map.getSource(
                  PROJECT_SOURCE
                ) as any;


              if (!source) {
                return;
              }


              const zoom =
                await source
                  .getClusterExpansionZoom(
                    clusterId
                  );


              const coordinates =
                (
                  feature
                    .geometry as any
                )
                  .coordinates;


              map.easeTo(
                {
                  center:
                    coordinates,

                  zoom,
                }
              );
            }
          );


          // ==================================================
          // CURSOR
          // ==================================================

          map.on(
            "mouseenter",
            LAYER_PROJECTS,
            () => {

              map
                .getCanvas()
                .style
                .cursor =
                "pointer";
            }
          );


          map.on(
            "mouseleave",
            LAYER_PROJECTS,
            () => {

              map
                .getCanvas()
                .style
                .cursor =
                "";
            }
          );


          map.on(
            "mouseenter",
            LAYER_CLUSTERS,
            () => {

              map
                .getCanvas()
                .style
                .cursor =
                "pointer";
            }
          );


          map.on(
            "mouseleave",
            LAYER_CLUSTERS,
            () => {

              map
                .getCanvas()
                .style
                .cursor =
                "";
            }
          );
        }
      );


      // ======================================================
      // WHEN STREET/SATELLITE STYLE CHANGES
      // ======================================================

      map.on(
        "style.load",
        () => {

          syncMapLayers(
            map,
            projectsRef.current,
            selectedRef.current
          );


          if (
            is3DRef.current
          ) {

            map.enableTerrain(
              1.15
            );

            map.easeTo(
              {
                pitch:
                  60,

                bearing:
                  -12,

                duration:
                  400,
              }
            );
          }
        }
      );


      return () => {

        setMapReady(
          false
        );

        map.remove();

        mapRef.current =
          null;
      };

    },
    []
  );


  // ==========================================================
  // UPDATE PROJECT DATA
  // ==========================================================

  useEffect(
    () => {

      const map =
        mapRef.current;


      if (
        !map ||
        !mapReady
      ) {
        return;
      }


      syncMapLayers(
        map,
        gisProjects,
        selectedRef.current
      );

    },
    [
      gisProjects,
      mapReady,
    ]
  );


  // ==========================================================
  // UPDATE SELECTED PROJECT
  // ==========================================================

  useEffect(
    () => {

      const map =
        mapRef.current;


      if (
        !map ||
        !mapReady
      ) {
        return;
      }


      syncMapLayers(
        map,
        projectsRef.current,
        gisSelected
      );


      if (gisSelected) {

        focusProject(
          map,
          gisSelected
        );
      }

    },
    [
      gisSelected,
      mapReady,
    ]
  );


  // ==========================================================
  // 2D / 3D
  // ==========================================================

  function toggle3D() {

    const map =
      mapRef.current;


    if (!map) {
      return;
    }


    const next =
      !is3D;


    setIs3D(
      next
    );


    is3DRef.current =
      next;


    if (next) {

      map.enableTerrain(
        1.15
      );


      map.easeTo(
        {
          pitch:
            60,

          bearing:
            -12,

          duration:
            800,
        }
      );

    } else {

      map.disableTerrain();


      map.easeTo(
        {
          pitch:
            0,

          bearing:
            0,

          duration:
            800,
        }
      );
    }
  }


  // ==========================================================
  // STREET / SATELLITE
  // ==========================================================

  function toggleSatellite() {

    const map =
      mapRef.current;


    if (!map) {
      return;
    }


    const next =
      !satellite;


    setSatellite(
      next
    );


    // HYBRID =
    // satellite + roads + labels
    map.setStyle(
      next
        ? maptilersdk
            .MapStyle
            .HYBRID

        : maptilersdk
            .MapStyle
            .STREETS
    );
  }


  // ==========================================================
  // SEARCH SELECT
  // ==========================================================

  function chooseProject(
    project: GISProject
  ) {

    selectCallbackRef
      .current
      ?.(project);


    setSearch(
      ""
    );


    const map =
      mapRef.current;


    if (!map) {
      return;
    }


    focusProject(
      map,
      project
    );
  }


  // ==========================================================
  // API KEY
  // ==========================================================

  const hasApiKey =
    Boolean(
      import.meta.env
        .VITE_MAPTILER_KEY
    );


  // ==========================================================
  // UI
  // ==========================================================

  return (

    <section
      className=
        "acquitwin-gis"
    >

      {/* =====================================================
          TOP TOOLBAR
      ===================================================== */}

      <div
        className=
          "gis-toolbar"
      >

        {/* SEARCH */}

        <div
          className=
            "gis-search-container"
        >

          <input
            className=
              "gis-search"

            type=
              "search"

            value={
              search
            }

            placeholder=
              "Search project, NH, state or district..."

            onChange={
              (
                event
              ) => {

                setSearch(
                  event
                    .target
                    .value
                );
              }
            }
          />


          {
            search.trim() !== "" &&
            (

              <div
                className=
                  "gis-search-results"
              >

                {
                  searchResults.length ===
                  0
                    ? (

                      <div
                        className=
                          "gis-no-results"
                      >

                        No matching projects

                      </div>

                    )
                    : (

                      searchResults.map(
                        (
                          project
                        ) => {

                          const mapped =
                            getProjectCoordinate(
                              project
                            ) !== null;


                          return (

                            <button
                              key={
                                project.id
                              }

                              type=
                                "button"

                              className=
                                "gis-search-result"

                              onClick={
                                () =>
                                  chooseProject(
                                    project
                                  )
                              }
                            >

                              <strong>
                                {
                                  project
                                    .project_id
                                }
                              </strong>


                              <span>
                                {
                                  project
                                    .project_name
                                }
                              </span>


                              <small>

                                {
                                  project
                                    .state
                                  ??
                                  "State unavailable"
                                }

                                {" · "}

                                {
                                  mapped
                                    ? "GIS mapped"
                                    : "GIS unresolved"
                                }

                              </small>

                            </button>
                          );
                        }
                      )
                    )
                }

              </div>
            )
          }

        </div>


        {/* MAP CONTROLS */}

        <div
          className=
            "gis-mode-buttons"
        >

          <button
            type=
              "button"

            className={
              is3D
                ? "gis-button active"
                : "gis-button"
            }

            onClick={
              toggle3D
            }
          >

            {
              is3D
                ? "3D ON"
                : "3D"
            }

          </button>


          <button
            type=
              "button"

            className={
              satellite
                ? "gis-button active"
                : "gis-button"
            }

            onClick={
              toggleSatellite
            }
          >

            {
              satellite
                ? "Satellite"
                : "Street"
            }

          </button>

        </div>

      </div>


      {/* =====================================================
          MAP STATS
      ===================================================== */}

      <div
        className=
          "gis-stats"
      >

        <span>

          <strong>
            {
              projects.length
            }
          </strong>

          {" "}
          projects

        </span>


        <span>

          <strong>
            {
              mappedCount
            }
          </strong>

          {" "}
          mapped

        </span>


        <span>

          <strong>
            {
              unresolvedCount
            }
          </strong>

          {" "}
          awaiting GIS

        </span>

      </div>


      {/* =====================================================
          KEY WARNING
      ===================================================== */}

      {
        !hasApiKey &&
        (

          <div
            className=
              "gis-key-warning"
          >

            MapTiler API key missing.

            Add

            {" "}

            <code>
              VITE_MAPTILER_KEY
            </code>

            {" "}

            to

            {" "}

            <code>
              frontend/.env
            </code>

          </div>
        )
      }


      {/* =====================================================
          MAP
      ===================================================== */}

      <div
        ref={
          mapContainerRef
        }

        className=
          "gis-map"
      />


      {/* =====================================================
          SELECTED PROJECT
      ===================================================== */}

      {
        gisSelected &&
        (

          <aside
            className=
              "gis-project-panel"
          >

            <div
              className=
                "gis-project-panel-header"
            >

              <div>

                <small>
                  SELECTED PROJECT
                </small>

                <strong>
                  {
                    gisSelected
                      .project_id
                  }
                </strong>

              </div>


              <span
                className={
                  `gis-risk risk-${getRiskLevel(
                    gisSelected
                  ).toLowerCase()}`
                }
              >

                {
                  getRiskLevel(
                    gisSelected
                  )
                }

              </span>

            </div>


            <h3>
              {
                gisSelected
                  .project_name
              }
            </h3>


            <div
              className=
                "gis-project-grid"
            >

              <div>
                <span>
                  State
                </span>

                <strong>
                  {
                    gisSelected.state
                    ??
                    "Not recorded"
                  }
                </strong>
              </div>


              <div>
                <span>
                  District
                </span>

                <strong>
                  {
                    gisSelected.district
                    ??
                    "Not recorded"
                  }
                </strong>
              </div>


              <div>
                <span>
                  Stage
                </span>

                <strong>
                  {
                    gisSelected
                      .current_stage
                    ??
                    "Not recorded"
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
                      gisSelected
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
                    formatLandProgress(
                      gisSelected
                    )
                  }
                </strong>
              </div>


              <div>
                <span>
                  GIS accuracy
                </span>

                <strong>
                  {
                    gisSelected
                      .location_accuracy
                    ??
                    (
                      getProjectCoordinate(
                        gisSelected
                      )
                        ? "RECORDED"
                        : "UNRESOLVED"
                    )
                  }
                </strong>
              </div>


              <div>
                <span>
                  Start
                </span>

                <strong>
                  {
                    getStartCoordinate(
                      gisSelected
                    )
                      ? "Available"
                      : "Not recorded"
                  }
                </strong>
              </div>


              <div>
                <span>
                  End
                </span>

                <strong>
                  {
                    getEndCoordinate(
                      gisSelected
                    )
                      ? "Available"
                      : "Not recorded"
                  }
                </strong>
              </div>

            </div>


            {
              !getProjectCoordinate(
                gisSelected
              ) &&
              (

                <div
                  className=
                    "gis-information"
                >

                  This project exists in
                  AcquiTwin, but its GIS
                  position has not yet
                  been resolved.

                </div>
              )
            }


            {
              getStartCoordinate(
                gisSelected
              ) &&
              getEndCoordinate(
                gisSelected
              ) &&
              !readRouteCoordinates(
                gisSelected
              ) &&
              (

                <div
                  className=
                    "gis-route-information"
                >

                  Orange dashed route =
                  approximate start/end
                  connection. It is not
                  presented as the exact
                  highway alignment.

                </div>
              )
            }

          </aside>
        )
      }


      {/* =====================================================
          LEGEND
      ===================================================== */}

      <div
        className=
          "gis-legend"
      >

        <span>
          <i className="dot low" />
          Low
        </span>

        <span>
          <i className="dot medium" />
          Medium
        </span>

        <span>
          <i className="dot high" />
          High
        </span>

        <span>
          <i className="dot critical" />
          Critical
        </span>

        <span>
          <i className="dot start" />
          Start
        </span>

        <span>
          <i className="dot end" />
          End
        </span>

      </div>

    </section>
  );
}