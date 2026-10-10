const CENTER_LAT = 47.5;
const CENTER_LON = -121.5;

const MIN_MAGNITUDE = 2.5;
const DAYS_BACK = 7;
const EARTHQUAKE_RESULT_CAP = 5000;
const EARTHQUAKE_REQUEST_LIMIT = EARTHQUAKE_RESULT_CAP + 1;
const MAP_QUERY_DEBOUNCE_MS = 350;

let displayCount = 10;
let earthquakes = [];
let markers = [];
let sortColumn = "time";
let sortDirection = "desc";
let selectedEventId = null;
let earthquakeRequestController = null;
let earthquakeRequestId = 0;
let earthquakeLoadTimer = null;
let lastEarthquakeBoundsKey = null;
let activeEarthquakeBoundsKey = null;
let programmaticMapMove = false;

const map = L.map("map").setView([CENTER_LAT, CENTER_LON], 5);

if (window.innerWidth <= 768) {
  map.dragging.disable();
}

L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }
).addTo(map);

const earthquakeLayer = L.layerGroup().addTo(map);

map.createPane("faultPane").style.zIndex = 350;
map.createPane("volcanoPane").style.zIndex = 390;

const volcanoLayer = L.geoJSON(null, {
  pointToLayer: (feature, latlng) =>
    L.circleMarker(latlng, {
      pane: "volcanoPane",
      radius: 7,
      color: "#713b16",
      weight: 1.5,
      fillColor: "#f0a52b",
      fillOpacity: 0.95
    }),
  onEachFeature: (feature, layer) => {
    const popup = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = feature.properties.name || "Unnamed volcano";
    popup.appendChild(name);

    if (feature.properties.status) {
      const status = document.createElement("div");
      status.textContent = feature.properties.status;
      popup.appendChild(status);
    }

    layer.bindPopup(popup);
  }
});

const faultRenderer = L.canvas({ pane: "faultPane" });
const faultLayer = L.geoJSON(null, {
  renderer: faultRenderer,
  style: {
    color: "#5d5960",
    weight: 1.25,
    opacity: 0.45
  },
  onEachFeature: (feature, layer) => {
    const faultName = feature.properties.fault_name;
    if (faultName) {
      const popup = document.createElement("span");
      popup.textContent = faultName;
      layer.bindPopup(popup);
    }
  }
});

const volcanoApiUrl =
  "https://volcanoes.usgs.gov/vsc/api/volcanoApi/regionstatus" +
  "?lat1=-90&long1=-1350&lat2=90&long2=1350";
const faultsQueryUrl =
  "https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer/21/query";
let volcanoLayerPromise;
let faultLayerPromise;

async function loadVolcanoLayer() {
  if (!volcanoLayerPromise) {
    volcanoLayerPromise = (async () => {
      const response = await fetch(volcanoApiUrl);
      if (!response.ok) {
        throw new Error(`USGS Volcano API returned ${response.status}`);
      }

      const volcanoes = await response.json();
      const features = volcanoes
        .filter((volcano) =>
          Number.isFinite(Number(volcano.lat)) &&
          Number.isFinite(Number(volcano.long))
        )
        .map((volcano) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [Number(volcano.long), Number(volcano.lat)]
          },
          properties: {
            name: volcano.vName,
            status: volcano.alertLevel || volcano.colorCode
          }
        }));

      volcanoLayer.addData({ type: "FeatureCollection", features });
    })().catch((error) => {
      volcanoLayerPromise = null;
      throw error;
    });
  }

  await volcanoLayerPromise;
}

async function loadFaultLayer() {
  if (!faultLayerPromise) {
    faultLayerPromise = (async () => {
      const features = [];
      let resultOffset = 0;

      while (true) {
        const params = new URLSearchParams({
          where: "1=1",
          outFields: "fault_name",
          outSR: "4326",
          f: "geojson",
          orderByFields: "OBJECTID",
          resultOffset: String(resultOffset),
          resultRecordCount: "2000"
        });
        const response = await fetch(`${faultsQueryUrl}?${params}`);
        if (!response.ok) {
          throw new Error(`USGS Faults API returned ${response.status}`);
        }

        const data = await response.json();
        if (data.error) {
          throw new Error(data.error.message || "USGS Faults API query failed");
        }

        const page = data.features || [];
        features.push(...page);

        if (!data.exceededTransferLimit) {
          break;
        }
        if (page.length === 0) {
          throw new Error("USGS Faults API returned an empty page");
        }

        resultOffset += page.length;
      }

      faultLayer.addData({ type: "FeatureCollection", features });
    })().catch((error) => {
      faultLayerPromise = null;
      throw error;
    });
  }

  await faultLayerPromise;
}

function addLayerToggle(container, id, labelText, layer, loadLayer, loadingMessage = "") {
  const label = document.createElement("label");
  label.htmlFor = id;

  let layerLoaded = false;
  const loading = document.createElement("span");
  loading.className = "map-layer-loading";
  loading.textContent = loadingMessage;
  loading.hidden = true;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = id;
  checkbox.addEventListener("change", async () => {
    if (!checkbox.checked) {
      layer.remove();
      return;
    }

    checkbox.disabled = true;
    if (!layerLoaded && loadingMessage) {
      loading.hidden = false;
    }
    try {
      await loadLayer();
      layer.addTo(map);
      layerLoaded = true;
    } catch (error) {
      console.error(`Unable to load ${labelText} layer`, error);
      checkbox.checked = false;
    } finally {
      loading.hidden = true;
      checkbox.disabled = false;
    }
  });

  label.append(checkbox, document.createTextNode(` ${labelText}`), loading);
  container.appendChild(label);
}

const geologyLayerControl = L.control({ position: "topright" });
geologyLayerControl.onAdd = () => {
  const container = L.DomUtil.create("div", "map-layer-controls");
  addLayerToggle(
    container,
    "volcanoes-toggle",
    "🌋 Volcanoes",
    volcanoLayer,
    loadVolcanoLayer
  );
  addLayerToggle(
    container,
    "faults-toggle",
    "〰 Faults",
    faultLayer,
    loadFaultLayer,
    "Loading…"
  );
  L.DomEvent.disableClickPropagation(container);
  return container;
};
geologyLayerControl.addTo(map);

const earthquakeApiUrl = "https://earthquake.usgs.gov/fdsnws/event/1/query";

function wrapLongitude(longitude) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function getEarthquakeBounds() {
  const bounds = map.getBounds();
  const south = Math.max(-90, bounds.getSouth());
  const north = Math.min(90, bounds.getNorth());
  const west = bounds.getWest();
  const east = bounds.getEast();

  if (east - west >= 360) {
    return {
      south,
      north,
      segments: [{ minlongitude: -180, maxlongitude: 180 }]
    };
  }

  const wrappedWest = wrapLongitude(west);
  const wrappedEast = wrapLongitude(east);
  const segments = wrappedWest <= wrappedEast
    ? [{ minlongitude: wrappedWest, maxlongitude: wrappedEast }]
    : [
        { minlongitude: wrappedWest, maxlongitude: 180 },
        { minlongitude: -180, maxlongitude: wrappedEast }
      ];

  return { south, north, segments };
}

function getBoundsKey(bounds) {
  const rounded = (value) => Math.round(value * 100) / 100;
  return [
    rounded(bounds.south),
    rounded(bounds.north),
    ...bounds.segments.flatMap((segment) => [
      rounded(segment.minlongitude),
      rounded(segment.maxlongitude)
    ])
  ].join(",");
}

function getEarthquakeQueryUrl(bounds, segment, startTime) {
  const params = new URLSearchParams({
    format: "geojson",
    minlatitude: String(bounds.south),
    maxlatitude: String(bounds.north),
    minlongitude: String(segment.minlongitude),
    maxlongitude: String(segment.maxlongitude),
    minmagnitude: String(MIN_MAGNITUDE),
    starttime: startTime,
    limit: String(EARTHQUAKE_REQUEST_LIMIT),
    orderby: "time"
  });
  return `${earthquakeApiUrl}?${params}`;
}

async function loadEarthquakes(bounds, boundsKey) {
  const requestId = ++earthquakeRequestId;
  const controller = new AbortController();
  earthquakeRequestController = controller;
  activeEarthquakeBoundsKey = boundsKey;
  const status = document.getElementById("status");
  const startTime = new Date(
    Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000
  ).toISOString();
  const boundsDescription = bounds.segments.length > 1
    ? "the current map area (crossing the International Date Line)"
    : "the current map area";
  status.textContent = `Loading M${MIN_MAGNITUDE}+ earthquakes from the past ${DAYS_BACK} days for ${boundsDescription}…`;

  try {
    const responses = await Promise.all(bounds.segments.map(async (segment) => {
      const response = await fetch(
        getEarthquakeQueryUrl(bounds, segment, startTime),
        { signal: controller.signal }
      );
      if (!response.ok) {
        throw new Error(`USGS returned HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!Array.isArray(data.features)) {
        throw new Error("USGS returned an invalid earthquake response");
      }
      return data;
    }));

    if (requestId !== earthquakeRequestId) {
      return;
    }

    const featuresById = new Map();
    let sourceLimitReached = false;
    responses.forEach((data) => {
      data.features.forEach((feature) => featuresById.set(feature.id, feature));
      const reportedCount = Number(data.metadata && data.metadata.count);
      if (
        data.features.length >= EARTHQUAKE_REQUEST_LIMIT ||
        (Number.isFinite(reportedCount) && reportedCount > data.features.length)
      ) {
        sourceLimitReached = true;
      }
    });

    earthquakes = Array.from(featuresById.values())
      .sort((a, b) => b.properties.time - a.properties.time);
    let safetyCapReached = false;
    if (earthquakes.length > EARTHQUAKE_RESULT_CAP) {
      earthquakes = earthquakes.slice(0, EARTHQUAKE_RESULT_CAP);
      safetyCapReached = true;
    }
    if (selectedEventId && !earthquakes.some((quake) => quake.id === selectedEventId)) {
      selectedEventId = null;
    }
    lastEarthquakeBoundsKey = boundsKey;
    renderEarthquakes();

    if (safetyCapReached) {
      status.textContent = `Showing the newest ${earthquakes.length} matching earthquakes (safety cap; more may match).`;
    } else if (sourceLimitReached) {
      status.textContent = `USGS reached its result limit; showing ${earthquakes.length} returned earthquakes. More may match this map area.`;
    } else if (earthquakes.length === 0) {
      status.textContent = `No M${MIN_MAGNITUDE}+ earthquakes were found in the current map area during the past ${DAYS_BACK} days.`;
    } else {
      status.textContent = `${earthquakes.length} matching M${MIN_MAGNITUDE}+ earthquakes from the past ${DAYS_BACK} days in the current map area.`;
    }
  } catch (error) {
    if (error.name === "AbortError" || requestId !== earthquakeRequestId) {
      return;
    }
    console.error(error);
    status.textContent = `Unable to load earthquake data from USGS: ${error.message}. Previous results remain visible, if available.`;
  } finally {
    if (requestId === earthquakeRequestId) {
      earthquakeRequestController = null;
      activeEarthquakeBoundsKey = null;
    }
  }
}

function scheduleEarthquakeLoad() {
  clearTimeout(earthquakeLoadTimer);
  const bounds = getEarthquakeBounds();
  const boundsKey = getBoundsKey(bounds);
  if (
    earthquakeRequestController &&
    activeEarthquakeBoundsKey !== boundsKey
  ) {
    earthquakeRequestController.abort();
    earthquakeRequestController = null;
    activeEarthquakeBoundsKey = null;
    earthquakeRequestId += 1;
  }
  earthquakeLoadTimer = setTimeout(() => {
    if (
      boundsKey !== lastEarthquakeBoundsKey &&
      activeEarthquakeBoundsKey !== boundsKey
    ) {
      loadEarthquakes(bounds, boundsKey);
    }
  }, MAP_QUERY_DEBOUNCE_MS);
}

function getDisplayedEarthquakes() {
  // First choose the newest 10/100 earthquakes.
  // Sorting changes their display order, not which events are included.
  const displayed = earthquakes.slice(0, displayCount);
  const selectedEarthquake = earthquakes.find(
    (quake) => quake.id === selectedEventId
  );
  if (selectedEarthquake && !displayed.includes(selectedEarthquake)) {
    displayed[displayed.length - 1] = selectedEarthquake;
  }

  displayed.sort((a, b) => {
    let valueA;
    let valueB;

    switch (sortColumn) {
      case "time":
        valueA = a.properties.time;
        valueB = b.properties.time;
        break;

      case "magnitude":
        valueA = a.properties.mag;
        valueB = b.properties.mag;
        break;

      case "location":
        valueA = a.properties.place || "";
        valueB = b.properties.place || "";
        return sortDirection === "asc"
          ? valueA.localeCompare(valueB)
          : valueB.localeCompare(valueA);

      case "depth":
        valueA = a.geometry.coordinates[2];
        valueB = b.geometry.coordinates[2];
        break;
    }

    return sortDirection === "asc"
      ? valueA - valueB
      : valueB - valueA;
  });

  return displayed;
}

function renderEarthquakes() {
  const tbody = document.getElementById("earthquake-list");

  tbody.innerHTML = "";
  earthquakeLayer.clearLayers();
  markers = [];
  const rowsByEventId = new Map();
  const markersByEventId = new Map();

  const displayedEarthquakes = getDisplayedEarthquakes();
  displayedEarthquakes.forEach((quake) => {
    const properties = quake.properties;
    const coordinates = quake.geometry.coordinates;

    const longitude = coordinates[0];
    const latitude = coordinates[1];
    const depth = coordinates[2];
    const depthMiles = depth * 0.621371;
    const place = (properties.place || "").replace(
      /^(\d+(?:\.\d+)?) km\b/,
      (_, distanceKm) => `${Math.round(Number(distanceKm) * 0.621371)} mi`
    );
    const eventDate = new Date(properties.time);
    
    const time = window.innerWidth <= 768
    ? eventDate.toLocaleString("en-US", {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
        })
        .replace(",", "")
        .replace(" AM", "A")
        .replace(" PM", "P")
    : eventDate.toLocaleString();

    const row = document.createElement("tr");

    // Stable connection between this row and the USGS earthquake.
    row.dataset.eventId = quake.id;

    [time, properties.mag.toFixed(1), place, `${depthMiles.toFixed(1)} mi`]
      .forEach((text, index) => {
        const cell = document.createElement("td");
        if (index === 2) {
          const location = document.createElement("div");
          location.className = "location-text";
          location.textContent = text;
          cell.appendChild(location);
        } else {
          cell.textContent = text;
        }
        row.appendChild(cell);
      });

    tbody.appendChild(row);
    rowsByEventId.set(quake.id, row);
  });

  earthquakes.forEach((quake) => {
    const properties = quake.properties;
    const coordinates = quake.geometry.coordinates;
    const latitude = coordinates[1];
    const longitude = coordinates[0];
    const depthMiles = coordinates[2] * 0.621371;
    const place = (properties.place || "").replace(
      /^(\d+(?:\.\d+)?) km\b/,
      (_, distanceKm) => `${Math.round(Number(distanceKm) * 0.621371)} mi`
    );
    const eventDate = new Date(properties.time);
    const time = eventDate.toLocaleString();
    const marker = L.circleMarker([latitude, longitude], {
      radius: Math.max(5, properties.mag * 2)
    });

    const popup = document.createElement("div");
    const magnitude = document.createElement("strong");
    magnitude.textContent = `M${properties.mag.toFixed(1)}`;
    popup.append(magnitude, document.createElement("br"));
    popup.append(document.createTextNode(place), document.createElement("br"));
    popup.append(
      document.createTextNode(`Depth: ${depthMiles.toFixed(1)} mi`),
      document.createElement("br"),
      document.createTextNode(time)
    );
    marker.bindPopup(popup);

    marker.addTo(earthquakeLayer);

    markers.push({
      eventId: quake.id,
      marker: marker
    });
    markersByEventId.set(quake.id, marker);

    marker.on("click", () => {
      selectEarthquake(quake.id, true);
    });
  });

  displayedEarthquakes.forEach((quake) => {
    const row = rowsByEventId.get(quake.id);
    const marker = markersByEventId.get(quake.id);
    if (quake.id === selectedEventId) {
      row.classList.add("selected");
    }
    row.addEventListener("click", () => {
      selectEarthquake(quake.id);
      programmaticMapMove = true;
      try {
        map.setView(
          [quake.geometry.coordinates[1], quake.geometry.coordinates[0]],
          8,
          { animate: false }
        );
      } finally {
        programmaticMapMove = false;
      }
      marker.openPopup();

      if (window.innerWidth <= 768) {
        document.getElementById("map").scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });
  });
}

function selectEarthquake(eventId, scrollToRow = false) {
  selectedEventId = eventId;
  let selectedRow = document.querySelector(
    `#earthquake-list tr[data-event-id="${CSS.escape(eventId)}"]`
  );
  if (!selectedRow) {
    renderEarthquakes();
    selectedRow = document.querySelector(
      `#earthquake-list tr[data-event-id="${CSS.escape(eventId)}"]`
    );
  }

  document.querySelectorAll("#earthquake-list tr").forEach((row) => {
    row.classList.remove("selected");
  });
  if (!selectedRow) {
    return;
  }
  selectedRow.classList.add("selected");

  if (scrollToRow) {
    selectedRow.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }
}

map.on("moveend", () => {
  if (!programmaticMapMove) {
    scheduleEarthquakeLoad();
  }
});
const initialEarthquakeBounds = getEarthquakeBounds();
loadEarthquakes(initialEarthquakeBounds, getBoundsKey(initialEarthquakeBounds));

document
  .getElementById("toggle-count")
  .addEventListener("click", () => {
    displayCount = displayCount === 10 ? 100 : 10;

    document.getElementById("toggle-count").textContent =
      displayCount === 10 ? "Show 100" : "Show 10";

    renderEarthquakes();
  });

document.querySelectorAll("th.sortable").forEach((header) => {
  header.addEventListener("click", () => {
    const selectedColumn = header.dataset.sort;

    if (sortColumn === selectedColumn) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortColumn = selectedColumn;

      // Sensible first-click defaults.
      sortDirection =
        selectedColumn === "location" ? "asc" : "desc";
    }

    updateSortIndicators();
    renderEarthquakes();
  });
});

function updateSortIndicators() {
  document.querySelectorAll("th.sortable").forEach((header) => {
    const indicator = header.querySelector(".sort-indicator");

    if (header.dataset.sort === sortColumn) {
      indicator.textContent =
        sortDirection === "asc" ? "▲" : "▼";
    } else {
      indicator.textContent = "";
    }
  });
}
