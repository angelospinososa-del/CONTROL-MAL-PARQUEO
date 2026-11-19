/* ============================================================================
 * ARCHIVO: mapa.js
 * RESPONSABILIDAD: Gestión de los mapas Leaflet (mapa de captura y mapa de
 * registros) en funciones separadas, dibujo de cuadras, marcador arrastrable
 * y marcadores coloreados por nivel de criticidad. Tolera fallos sin conexión.
 * ============================================================================ */

var mapaCaptura = null;
var marcadorCaptura = null;
var capaCuadrasCaptura = null;
var capaReportesCaptura = null;
var polilineasCuadras = {};

var mapaRegistros = null;
var capaMarcadoresRegistros = null;

/**
 * Devuelve true si la librería Leaflet (L) está cargada en el navegador.
 */
function leafletDisponible() {
  return typeof L !== "undefined" && L !== null;
}

/**
 * Devuelve el color hexadecimal asociado a cada nivel de criticidad.
 */
function obtenerColorNivel(nivel) {
  var clave = String(nivel || "").toLowerCase();
  if (clave === "alto") return "#dc2626";   // Rojo
  if (clave === "medio") return "#d97706";  // Ámbar / Naranja
  return "#16a34a";                         // Verde (Bajo)
}

/**
 * Inicializa el mapa de la vista Captura con OpenStreetMap y las cuadras de vias.json.
 * Entradas:
 *   - idContenedor: string del ID del div en HTML (ej. "mapa-captura")
 *   - vias: objeto cargado desde datos/vias.json
 *   - alElegirUbicacion: función callback(lat, lng) al tocar el mapa o arrastrar marcador
 * Salida: true si el mapa inició, false si no hay conexión o falló Leaflet.
 */
function iniciarMapaCaptura(idContenedor, vias, alElegirUbicacion) {
  if (!leafletDisponible()) {
    return false;
  }

  var centro = (vias && vias.zona && vias.zona.centro) ? vias.zona.centro : [11.2421, -74.2108];
  var zoom = (vias && vias.zona && vias.zona.zoom) ? vias.zona.zoom : 17;

  mapaCaptura = L.map(idContenedor, {
    zoomControl: true
  }).setView(centro, zoom);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(mapaCaptura);

  capaCuadrasCaptura = L.layerGroup().addTo(mapaCaptura);
  capaReportesCaptura = L.layerGroup().addTo(mapaCaptura);
  polilineasCuadras = {};

  // Dibujar las cuadras definidas en vias.json como líneas interactivas
  if (vias && Array.isArray(vias.cuadras)) {
    for (var i = 0; i < vias.cuadras.length; i++) {
      var cuadra = vias.cuadras[i];
      if (!Array.isArray(cuadra.extremos) || cuadra.extremos.length < 2) continue;

      var linea = L.polyline(cuadra.extremos, {
        color: "#475569",
        weight: 5,
        opacity: 0.7
      });

      linea.bindTooltip(cuadra.nombre + " (" + cuadra.tipo_via + ")", {
        sticky: true
      });

      // Permitir tocar directamente encima de una cuadra para marcar el punto
      linea.on("click", function (e) {
        if (typeof alElegirUbicacion === "function") {
          alElegirUbicacion(e.latlng.lat, e.latlng.lng);
        }
      });

      linea.addTo(capaCuadrasCaptura);
      polilineasCuadras[cuadra.id] = linea;
    }
  }

  // Evento al tocar cualquier parte del mapa de captura
  mapaCaptura.on("click", function (e) {
    if (typeof alElegirUbicacion === "function") {
      alElegirUbicacion(e.latlng.lat, e.latlng.lng);
    }
  });

  return true;
}

/**
 * Crea o mueve el marcador arrastrable de ubicación en el mapa de captura.
 */
function actualizarMarcadorCaptura(lat, lng, alArrastrar) {
  if (!leafletDisponible() || !mapaCaptura) return;

  var posicion = [lat, lng];

  if (!marcadorCaptura) {
    marcadorCaptura = L.marker(posicion, {
      draggable: true,
      title: "Arrastra para ajustar la ubicación exacta"
    }).addTo(mapaCaptura);

    marcadorCaptura.on("dragend", function () {
      var pos = marcadorCaptura.getLatLng();
      if (typeof alArrastrar === "function") {
        alArrastrar(pos.lat, pos.lng);
      }
    });
  } else {
    marcadorCaptura.setLatLng(posicion);
  }

  mapaCaptura.panTo(posicion);
}

/**
 * Resalta visualmente la cuadra asignada en el mapa de captura y atenúa las demás.
 */
function resaltarCuadraCaptura(cuadraId) {
  if (!leafletDisponible() || !mapaCaptura) return;

  var ids = Object.keys(polilineasCuadras);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var linea = polilineasCuadras[id];
    if (id === cuadraId) {
      linea.setStyle({
        color: "#0284c7",
        weight: 9,
        opacity: 1
      });
      linea.bringToFront();
    } else {
      linea.setStyle({
        color: "#64748b",
        weight: 5,
        opacity: 0.55
      });
    }
  }
}

/**
 * Dibuja puntos pequeños de referencia de los reportes ya guardados en el mapa de captura.
 */
function actualizarPuntosEnMapaCaptura(listaReportes) {
  if (!leafletDisponible() || !mapaCaptura || !capaReportesCaptura) return;

  capaReportesCaptura.clearLayers();

  for (var i = 0; i < listaReportes.length; i++) {
    var r = listaReportes[i];
    var nivel = r.criticidad ? r.criticidad.nivel : "Bajo";
    var color = obtenerColorNivel(nivel);

    L.circleMarker([r.lat, r.lng], {
      radius: 6,
      fillColor: color,
      color: "#ffffff",
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.85
    })
      .bindPopup(
        "<strong>" + r.id + "</strong><br>" +
        "Cuadra: " + r.cuadra + "<br>" +
        "Nivel: " + nivel + " (" + (r.criticidad ? r.criticidad.puntaje : "-") + ")"
      )
      .addTo(capaReportesCaptura);
  }
}

/**
 * Recalcula el tamaño del mapa de captura cuando su contenedor pasa de oculto a visible.
 */
function redimensionarMapaCaptura() {
  if (leafletDisponible() && mapaCaptura) {
    setTimeout(function () {
      mapaCaptura.invalidateSize();
    }, 60);
  }
}

/**
 * Inicializa el mapa de la vista Registros con su leyenda por nivel de criticidad.
 */
function iniciarMapaRegistros(idContenedor, vias) {
  if (!leafletDisponible()) {
    return false;
  }

  var centro = (vias && vias.zona && vias.zona.centro) ? vias.zona.centro : [11.2421, -74.2108];
  var zoom = (vias && vias.zona && vias.zona.zoom) ? vias.zona.zoom : 16;

  mapaRegistros = L.map(idContenedor, {
    zoomControl: true
  }).setView(centro, zoom);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(mapaRegistros);

  capaMarcadoresRegistros = L.layerGroup().addTo(mapaRegistros);

  // Agregar leyenda de colores por nivel de criticidad
  var leyenda = L.control({ position: "bottomright" });
  leyenda.onAdd = function () {
    var div = L.DomUtil.create("div", "leyenda-mapa");
    div.innerHTML =
      "<strong>Criticidad</strong>" +
      '<div><span class="punto-leyenda" style="background:#dc2626"></span> Alto</div>' +
      '<div><span class="punto-leyenda" style="background:#d97706"></span> Medio</div>' +
      '<div><span class="punto-leyenda" style="background:#16a34a"></span> Bajo</div>';
    return div;
  };
  leyenda.addTo(mapaRegistros);

  return true;
}

/**
 * Dibuja un marcador coloreado por nivel de criticidad para cada reporte activo.
 */
function actualizarMarcadoresRegistros(listaReportes, vias) {
  if (!leafletDisponible() || !mapaRegistros || !capaMarcadoresRegistros) return;

  capaMarcadoresRegistros.clearLayers();
  var coordenadas = [];

  for (var i = 0; i < listaReportes.length; i++) {
    var r = listaReportes[i];
    var nivel = r.criticidad ? r.criticidad.nivel : "Bajo";
    var puntaje = r.criticidad ? r.criticidad.puntaje : 0;
    var color = obtenerColorNivel(nivel);

    var marcador = L.circleMarker([r.lat, r.lng], {
      radius: 8,
      fillColor: color,
      color: "#ffffff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    });

    marcador.bindPopup(
      "<strong>" + r.id + "</strong> (" + r.origen + ")<br>" +
      "Fecha: " + r.fecha_hora.replace("T", " ") + "<br>" +
      "Cuadra: " + r.cuadra + "<br>" +
      "Nivel: <strong>" + nivel + " (" + puntaje + ")</strong>"
    );

    marcador.addTo(capaMarcadoresRegistros);
    coordenadas.push([r.lat, r.lng]);
  }

  if (coordenadas.length > 0) {
    var limites = L.latLngBounds(coordenadas);
    mapaRegistros.fitBounds(limites, { padding: [24, 24], maxZoom: 17 });
  } else if (vias && vias.zona && vias.zona.centro) {
    mapaRegistros.setView(vias.zona.centro, vias.zona.zoom || 16);
  }
}

/**
 * Recalcula el tamaño del mapa de registros cuando se abre la pestaña Registros.
 */
function redimensionarMapaRegistros() {
  if (leafletDisponible() && mapaRegistros) {
    setTimeout(function () {
      mapaRegistros.invalidateSize();
    }, 60);
  }
}
