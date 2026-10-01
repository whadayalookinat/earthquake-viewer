const CENTER_LAT = 47.5;
const CENTER_LON = -121.5;

const RADIUS_MILES = 500;
const RADIUS_KM = Math.round(RADIUS_MILES * 1.60934);

const MIN_MAGNITUDE = 2.5;

let displayCount = 10;
let earthquakes = [];
let markers = [];
let sortColumn = "time";
let sortDirection = "desc";

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

const apiUrl =
  "https://earthquake.usgs.gov/fdsnws/event/1/query" +
  "?format=geojson" +
  "&latitude=" + CENTER_LAT +
  "&longitude=" + CENTER_LON +
  "&maxradiuskm=" + RADIUS_KM +
  "&minmagnitude=" + MIN_MAGNITUDE +
  "&limit=100" +
  "&orderby=time";

async function loadEarthquakes() {
  const status = document.getElementById("status");

  try {
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`USGS returned ${response.status}`);
    }

    const data = await response.json();

    earthquakes = data.features;

    status.textContent =
      `${earthquakes.length} recent M${MIN_MAGNITUDE}+ earthquakes found within ${RADIUS_MILES} miles.`;

    renderEarthquakes();
  } catch (error) {
    console.error(error);
    status.textContent = "Unable to load earthquake data.";
  }
}

function getDisplayedEarthquakes() {
  // First choose the newest 10/100 earthquakes.
  // Sorting changes their display order, not which events are included.
  const displayed = earthquakes.slice(0, displayCount);

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

  getDisplayedEarthquakes().forEach((quake) => {
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

    row.innerHTML = `
        <td>${time}</td>
        <td>${properties.mag.toFixed(1)}</td>
        <td><div class="location-text">${place}</div></td>
        <td>${depthMiles.toFixed(1)} mi</td>
        `;

    tbody.appendChild(row);

    const marker = L.circleMarker([latitude, longitude], {
      radius: Math.max(5, properties.mag * 2)
    });

    marker.bindPopup(`
      <strong>M${properties.mag.toFixed(1)}</strong><br>
      ${place}<br>
      Depth: ${depthMiles.toFixed(1)} mi<br>
      ${time}
    `);

    marker.addTo(earthquakeLayer);

    markers.push({
      eventId: quake.id,
      marker: marker
    });

    row.addEventListener("click", () => {
    selectEarthquake(quake.id);

    map.setView([latitude, longitude], 8);
    marker.openPopup();

    if (window.innerWidth <= 768) {
        document.getElementById("map").scrollIntoView({
        behavior: "smooth",
        block: "start"
        });
    }
    });

    marker.on("click", () => {
      selectEarthquake(quake.id, true);
    });
  });
}

function selectEarthquake(eventId, scrollToRow = false) {
  document.querySelectorAll("#earthquake-list tr").forEach((row) => {
    row.classList.remove("selected");
  });

  const selectedRow = document.querySelector(
    `#earthquake-list tr[data-event-id="${eventId}"]`
  );

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

loadEarthquakes();