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

L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }
).addTo(map);

const earthquakeLayer = L.layerGroup().addTo(map);

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