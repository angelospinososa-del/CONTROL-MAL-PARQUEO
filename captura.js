/* ============================================================================
- ARCHIVO: captura.js
- RESPONSABILIDAD: Controlador principal. Carga criterios.json y reportes.json,
- gestiona GPS, ubicación exacta ingresada por el usuario, validación del
- formulario, procesamiento/pixelado irreversible de foto en canvas, armado
- del reporte, guardado en localStorage y renderizado de la vista Registros.
- ============================================================================ */

// Configuración base de zona sin depender de vias.json externo
var ZONA_BASE_SANTA_MARTA = {
  zona: {
    nombre: "Santa Marta · Registro libre",
    centro: [11.2421, -74.2108],
    zoom: 16,
    limites: {
      lat_min: 11.10,
      lat_max: 11.35,
      lng_min: -74.30,
      lng_max: -74.10
    }
  },
  cuadras: []
};

// Estado único compartido en memoria
var AppEstado = {
  vias: ZONA_BASE_SANTA_MARTA,
  criterios: null,
  reportesPrecargados: [],
  reportesLocales: [],
  reportesActivos: [],
  config: { iniciales: "", origen: "campo" },

  // Estado del formulario de captura actual
  lat: null,
  lng: null,
  precisionGps: null,
  cuadraAsignada: "",
  tipoViaSeleccionada: "",
  categoriaSeleccionada: "",
  actorSeleccionado: "",
  tieneFoto: false,
  fechaHoraManual: false,
  guardando: false,
  inicioCronometroMs: Date.now()
};

// Variables para el canvas y el pixelado táctil
var historialCanvas = [];
var dibujandoPixelado = false;
var puntoInicioPixel = null;

// Diccionarios de etiquetas legibles para la interfaz
var ETIQUETAS_CATEGORIA = {
  doble_fila: "Doble fila / vía prohibida",
  bloqueo_rampa_cebra_paradero: "Bloqueo rampa, cebra o paradero",
  invasion_anden: "Invasión de andén"
};

var ETIQUETAS_ACTOR = {
  vehiculo_particular: "Vehículo particular",
  motocicleta: "Motocicleta",
  vehiculo_carga: "Vehículo de carga",
  mobiliario_comercial: "Mobiliario comercial"
};

/**
- Formatea la hora LOCAL actual del dispositivo como "AAAA-MM-DDTHH:MM".
 */
function obtenerFechaHoraLocal() {
  var d = new Date();
  var anio = String(d.getFullYear());
  var mes = String(d.getMonth() + 1).padStart(2, "0");
  var dia = String(d.getDate()).padStart(2, "0");
  var hora = String(d.getHours()).padStart(2, "0");
  var min = String(d.getMinutes()).padStart(2, "0");
  return anio + "-" + mes + "-" + dia + "T" + hora + ":" + min;
}

/**
- Registra dinámicamente una ubicación escrita por el usuario dentro de
- AppEstado.vias.cuadras para que criticidad.js y almacenamiento.js la reconozcan.
 */
function registrarUbicacionEnVias(textoUbicacion, tipoVia) {
  if (!textoUbicacion) return;
  if (!AppEstado.vias || !Array.isArray(AppEstado.vias.cuadras)) {
    AppEstado.vias = ZONA_BASE_SANTA_MARTA;
  }

  var tipoFinal = tipoVia === "arterial" ? "arterial" : "secundaria";
  for (var i = 0; i < AppEstado.vias.cuadras.length; i++) {
    if (AppEstado.vias.cuadras[i].id === textoUbicacion) {
      if (tipoVia) {
        AppEstado.vias.cuadras[i].tipo_via = tipoFinal;
      }
      return;
    }
  }

  AppEstado.vias.cuadras.push({
    id: textoUbicacion,
    nombre: textoUbicacion,
    tipo_via: tipoFinal
  });
}

/**
- Reconstruye la lista única de reportes (precargados + locales) recalculando
- la criticidad de todos con las reglas vigentes de criterios.json.
 */
function sincronizarListaUnicaReportes() {
  AppEstado.reportesLocales = cargarReportesLocales();

  var idsPrecargados = {};
  for (var i = 0; i < AppEstado.reportesPrecargados.length; i++) {
    var repPre = Object.assign({}, AppEstado.reportesPrecargados[i], { _origenArchivo: "precargado" });
    idsPrecargados[repPre.id] = repPre;
    registrarUbicacionEnVias(repPre.cuadra, repPre.tipo_via);
  }

  var combinados = [];
  for (var j = 0; j < AppEstado.reportesPrecargados.length; j++) {
    combinados.push(
      Object.assign({}, AppEstado.reportesPrecargados[j], { _esLocal: false })
    );
  }

  for (var k = 0; k < AppEstado.reportesLocales.length; k++) {
    var repLoc = AppEstado.reportesLocales[k];
    registrarUbicacionEnVias(repLoc.cuadra, repLoc.tipo_via);
    if (!idsPrecargados[repLoc.id]) {
      combinados.push(Object.assign({}, repLoc, { _esLocal: true }));
    }
  }

  AppEstado.reportesActivos = recalcularTodosLosReportes(
    combinados,
    AppEstado.criterios,
    AppEstado.vias
  );

  actualizarPuntosEnMapaCaptura(AppEstado.reportesActivos);
  actualizarMarcadoresRegistros(AppEstado.reportesActivos, AppEstado.vias);
  renderizarVistaRegistros();
}

/**
- Carga los archivos JSON iniciales (criterios y reportes precargados).
 */
function cargarDatosIniciales() {
  return Promise.all([
    fetch("datos/criterios.json").then(function (r) {
      if (!r.ok) throw new Error("No se pudo cargar datos/criterios.json");
      return r.json();
    }),
    fetch("datos/reportes.json").then(function (r) {
      if (!r.ok) throw new Error("No se pudo cargar datos/reportes.json");
      return r.json();
    })
  ]);
}

/**
- Actualiza las coordenadas seleccionadas (redondeadas a 6 decimales)
- y mueve el marcador azul en el mapa.
 */
function fijarUbicacion(lat, lng, precisionMetros) {
  var latRedondeada = Number(Number(lat).toFixed(6));
  var lngRedondeada = Number(Number(lng).toFixed(6));

  AppEstado.lat = latRedondeada;
  AppEstado.lng = lngRedondeada;
  AppEstado.precisionGps = typeof precisionMetros === "number" ? Math.round(precisionMetros) : null;

  var textoCoords = document.getElementById("texto-coordenadas");
  textoCoords.textContent = "Lat: " + latRedondeada.toFixed(6) + ", Lng: " + lngRedondeada.toFixed(6);

  var avisoPrec = document.getElementById("aviso-precision");
  if (AppEstado.precisionGps !== null) {
    if (AppEstado.precisionGps > 50) {
      avisoPrec.textContent =
        "Precisión GPS baja (±" + AppEstado.precisionGps + " m). Ajusta el marcador en el mapa si es necesario.";
      avisoPrec.className = "aviso-alerta";
      avisoPrec.hidden = false;
    } else {
      avisoPrec.textContent = "Precisión GPS: ±" + AppEstado.precisionGps + " m.";
      avisoPrec.className = "aviso-info";
      avisoPrec.hidden = false;
    }
  } else {
    avisoPrec.hidden = true;
  }

  actualizarMarcadorCaptura(latRedondeada, lngRedondeada, function (nuevaLat, nuevaLng) {
    fijarUbicacion(nuevaLat, nuevaLng, null);
  });

  limpiarErrorCampo("error-ubicacion");
}

/**
- Solicita la ubicación GPS del dispositivo con alta precisión.
 */
function solicitarGpsDispositivo() {
  var estadoGps = document.getElementById("estado-gps");
  estadoGps.hidden = false;
  estadoGps.className = "aviso-info";
  estadoGps.textContent = "Buscando señal GPS...";

  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    estadoGps.className = "aviso-alerta";
    estadoGps.textContent = "El GPS requiere HTTPS o localhost. Marca el punto tocando el mapa.";
    return;
  }

  if (!("geolocation" in navigator)) {
    estadoGps.className = "aviso-alerta";
    estadoGps.textContent = "Este navegador no soporta geolocalización. Marca el punto en el mapa.";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function (posicion) {
      estadoGps.hidden = true;
      fijarUbicacion(
        posicion.coords.latitude,
        posicion.coords.longitude,
        posicion.coords.accuracy
      );
    },
    function (error) {
      estadoGps.className = "aviso-alerta";
      if (error.code === 1) {
        estadoGps.textContent = "Permiso de ubicación denegado. Marca el punto tocando el mapa.";
      } else if (error.code === 2) {
        estadoGps.textContent = "Sin señal GPS disponible en este punto. Marca la ubicación en el mapa.";
      } else if (error.code === 3) {
        estadoGps.textContent = "Tiempo de espera agotado al obtener GPS. Intenta de nuevo o marca en el mapa.";
      } else {
        estadoGps.textContent = "No se pudo obtener la ubicación (" + error.message + "). Marca en el mapa.";
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

/**
- Carga una imagen seleccionada desde cámara o galería y la dibuja en el canvas.
 */
function procesarArchivoFoto(archivo) {
  if (!archivo) return;

  var canvas = document.getElementById("canvas-foto");
  var ctx = canvas.getContext("2d");

  function dibujarEnCanvas(fuenteImagen, anchoOriginal, altoOriginal) {
    var anchoMax = 800;
    var escala = anchoOriginal > anchoMax ? anchoMax / anchoOriginal : 1;
    var nuevoAncho = Math.round(anchoOriginal * escala);
    var nuevoAlto = Math.round(altoOriginal * escala);

    canvas.width = nuevoAncho;
    canvas.height = nuevoAlto;
    ctx.clearRect(0, 0, nuevoAncho, nuevoAlto);
    ctx.drawImage(fuenteImagen, 0, 0, nuevoAncho, nuevoAlto);

    historialCanvas = [ctx.getImageData(0, 0, nuevoAncho, nuevoAlto)];
    AppEstado.tieneFoto = true;

    document.getElementById("zona-edicion-foto").hidden = false;
    document.getElementById("check-privacidad-foto").checked = false;
    limpiarErrorCampo("error-foto");
  }

  if (typeof createImageBitmap === "function") {
    createImageBitmap(archivo)
      .then(function (bitmap) {
        dibujarEnCanvas(bitmap, bitmap.width, bitmap.height);
        if (typeof bitmap.close === "function") bitmap.close();
      })
      .catch(function () {
        cargarConFileReader(archivo, dibujarEnCanvas);
      });
  } else {
    cargarConFileReader(archivo, dibujarEnCanvas);
  }
}

function cargarConFileReader(archivo, callback) {
  var lector = new FileReader();
  lector.onload = function (ev) {
    var img = new Image();
    img.onload = function () {
      callback(img, img.width, img.height);
    };
    img.src = ev.target.result;
  };
  lector.readAsDataURL(archivo);
}

/**
- Configura los eventos Pointer en el canvas para pixelar áreas rectangulares.
 */
function configurarHerramientaPixelado() {
  var canvas = document.getElementById("canvas-foto");
  var ctx = canvas.getContext("2d");

  function obtenerCoordsCanvas(evento) {
    var rect = canvas.getBoundingClientRect();
    var escalaX = canvas.width / rect.width;
    var escalaY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (evento.clientX - rect.left) * escalaX)),
      y: Math.max(0, Math.min(canvas.height, (evento.clientY - rect.top) * escalaY))
    };
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (!AppEstado.tieneFoto || historialCanvas.length === 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dibujandoPixelado = true;
    puntoInicioPixel = obtenerCoordsCanvas(e);
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!dibujandoPixelado || !puntoInicioPixel) return;
    e.preventDefault();
    var actual = obtenerCoordsCanvas(e);

    var estadoActual = historialCanvas[historialCanvas.length - 1];
    ctx.putImageData(estadoActual, 0, 0);

    var rx = Math.min(puntoInicioPixel.x, actual.x);
    var ry = Math.min(puntoInicioPixel.y, actual.y);
    var rw = Math.abs(actual.x - puntoInicioPixel.x);
    var rh = Math.abs(actual.y - puntoInicioPixel.y);

    ctx.save();
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 250));
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
  });

  function finalizarTrazoPixelado(e) {
    if (!dibujandoPixelado || !puntoInicioPixel) return;
    dibujandoPixelado = false;
    var fin = obtenerCoordsCanvas(e);

    var estadoActual = historialCanvas[historialCanvas.length - 1];
    ctx.putImageData(estadoActual, 0, 0);

    var rx = Math.floor(Math.min(puntoInicioPixel.x, fin.x));
    var ry = Math.floor(Math.min(puntoInicioPixel.y, fin.y));
    var rw = Math.floor(Math.abs(fin.x - puntoInicioPixel.x));
    var rh = Math.floor(Math.abs(fin.y - puntoInicioPixel.y));
    puntoInicioPixel = null;

    if (rw < 4 || rh < 4) return;

    var miniW = Math.max(1, Math.floor(rw / 12));
    var miniH = Math.max(1, Math.floor(rh / 12));

    var aux = document.createElement("canvas");
    aux.width = miniW;
    aux.height = miniH;
    var auxCtx = aux.getContext("2d");
    auxCtx.drawImage(canvas, rx, ry, rw, rh, 0, 0, miniW, miniH);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.drawImage(aux, 0, 0, miniW, miniH, rx, ry, rw, rh);
    ctx.restore();

    historialCanvas.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  canvas.addEventListener("pointerup", finalizarTrazoPixelado);
  canvas.addEventListener("pointercancel", finalizarTrazoPixelado);
}

/**
- Exporta el contenido del canvas como JPEG calidad 0.6 garantizando máximo 80 KB.
 */
function exportarCanvasComprimido() {
  if (!AppEstado.tieneFoto) return null;

  var canvas = document.getElementById("canvas-foto");
  var calidad = 0.6;
  var dataUrl = canvas.toDataURL("image/jpeg", calidad);

  function calcularBytesBase64(url) {
    var base64 = url.split(",")[1] || "";
    return Math.ceil((base64.length * 3) / 4);
  }

  var maxBytes = 80 * 1024;
  while (calcularBytesBase64(dataUrl) > maxBytes && calidad > 0.25) {
    calidad = Number((calidad - 0.1).toFixed(2));
    dataUrl = canvas.toDataURL("image/jpeg", calidad);
  }

  if (calcularBytesBase64(dataUrl) > maxBytes) {
    var reducido = document.createElement("canvas");
    reducido.width = Math.round(canvas.width * 0.8);
    reducido.height = Math.round(canvas.height * 0.8);
    reducido.getContext("2d").drawImage(canvas, 0, 0, reducido.width, reducido.height);
    dataUrl = reducido.toDataURL("image/jpeg", 0.55);
  }

  return dataUrl;
}

/**
- Limpia el canvas y reinicia el estado de foto del formulario.
 */
function quitarFotoFormulario() {
  var canvas = document.getElementById("canvas-foto");
  var ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  historialCanvas = [];
  AppEstado.tieneFoto = false;
  document.getElementById("input-foto-camara").value = "";
  document.getElementById("input-foto-galeria").value = "";
  document.getElementById("check-privacidad-foto").checked = false;
  document.getElementById("zona-edicion-foto").hidden = true;
  limpiarErrorCampo("error-foto");
}

function mostrarErrorCampo(idElemento, mensaje) {
  var el = document.getElementById(idElemento);
  if (el) {
    el.textContent = mensaje;
    el.hidden = false;
  }
}

function limpiarErrorCampo(idElemento) {
  var el = document.getElementById(idElemento);
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

/**
- Valida todos los campos obligatorios antes de guardar el reporte.
 */
function validarFormularioCaptura() {
  var esValido = true;

  // 1. Verificar iniciales del integrante
  if (!AppEstado.config.iniciales || AppEstado.config.iniciales.length < 2) {
    abrirModalAjustes();
    return false;
  }

  // 2. Verificar coordenadas y límites geográficos de Santa Marta
  var lim = AppEstado.vias && AppEstado.vias.zona && AppEstado.vias.zona.limites;
  if (AppEstado.lat === null || AppEstado.lng === null) {
    mostrarErrorCampo("error-ubicacion", "Marca el punto en el mapa o usa tu ubicación GPS.");
    esValido = false;
  } else if (
    lim &&
    (AppEstado.lat < lim.lat_min ||
      AppEstado.lat > lim.lat_max ||
      AppEstado.lng < lim.lng_min ||
      AppEstado.lng > lim.lng_max)
  ) {
    mostrarErrorCampo("error-ubicacion", "El punto está fuera de los límites de Santa Marta.");
    esValido = false;
  } else {
    limpiarErrorCampo("error-ubicacion");
  }

  // 3. Verificar dirección exacta y tipo de vía ingresados por el usuario
  var direccionTexto = (document.getElementById("input-cuadra").value || "").trim();
  if (!direccionTexto) {
    mostrarErrorCampo("error-cuadra", "Escribe la dirección o referencia exacta del vehículo.");
    esValido = false;
  } else if (!AppEstado.tipoViaSeleccionada) {
    mostrarErrorCampo("error-cuadra", "Selecciona si es vía arterial o vía secundaria.");
    esValido = false;
  } else {
    AppEstado.cuadraAsignada = direccionTexto;
    registrarUbicacionEnVias(direccionTexto, AppEstado.tipoViaSeleccionada);
    limpiarErrorCampo("error-cuadra");
  }

  // 4. Verificar categoría
  if (!AppEstado.categoriaSeleccionada) {
    mostrarErrorCampo("error-categoria", "Selecciona una categoría de obstrucción.");
    esValido = false;
  } else {
    limpiarErrorCampo("error-categoria");
  }

  // 5. Verificar actor
  if (!AppEstado.actorSeleccionado) {
    mostrarErrorCampo("error-actor", "Selecciona el tipo de actor.");
    esValido = false;
  } else {
    limpiarErrorCampo("error-actor");
  }

  // 6. Verificar casilla de privacidad si hay foto adjunta
  if (AppEstado.tieneFoto && !document.getElementById("check-privacidad-foto").checked) {
    mostrarErrorCampo("error-foto", "Debes confirmar que no se ven placas ni rostros antes de guardar.");
    esValido = false;
  } else {
    limpiarErrorCampo("error-foto");
  }

  return esValido;
}

/**
- Procesa el guardado completo de un nuevo reporte.
 */
function guardarNuevoReporte() {
  if (AppEstado.guardando) return;

  if (!validarFormularioCaptura()) {
    return;
  }

  AppEstado.guardando = true;
  var btnGuardar = document.getElementById("btn-guardar");
  btnGuardar.disabled = true;
  btnGuardar.textContent = "Guardando...";

  try {
    var fechaHoraValor = AppEstado.fechaHoraManual
      ? document.getElementById("input-fecha-hora").value
      : obtenerFechaHoraLocal();

    if (!fechaHoraValor || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fechaHoraValor)) {
      fechaHoraValor = obtenerFechaHoraLocal();
    }

    var nuevoId = generarSiguienteId(AppEstado.config.iniciales, AppEstado.reportesActivos);
    var fotoComprimida = exportarCanvasComprimido();
    var obsTexto = (document.getElementById("input-observaciones").value || "").trim().slice(0, 140);

    var borradorReporte = {
      id: nuevoId,
      origen: AppEstado.config.origen || "campo",
      fecha_hora: fechaHoraValor,
      lat: AppEstado.lat,
      lng: AppEstado.lng,
      cuadra: AppEstado.cuadraAsignada,
      tipo_via: AppEstado.tipoViaSeleccionada,
      categoria: AppEstado.categoriaSeleccionada,
      actor: AppEstado.actorSeleccionado,
      foto: fotoComprimida,
      observaciones: obsTexto
    };

    var calculo = calcularCriticidad(borradorReporte, AppEstado.criterios, AppEstado.vias);
    borradorReporte.criticidad = {
      puntaje: calculo.puntaje,
      nivel: calculo.nivel
    };

    var resultadoGuardado = agregarReporteLocal(borradorReporte);

    if (!resultadoGuardado.ok) {
      if (resultadoGuardado.errorQuota) {
        mostrarAlertaAlmacenamientoLleno(borradorReporte);
      } else {
        alert(resultadoGuardado.mensaje);
      }
      return;
    }

    var segundosLlenado = Math.max(1, Math.round((Date.now() - AppEstado.inicioCronometroMs) / 1000));

    sincronizarListaUnicaReportes();
    mostrarConfirmacionGuardado(borradorReporte, calculo, segundosLlenado);
  } catch (err) {
    alert("Error al procesar el reporte: " + err.message);
  } finally {
    AppEstado.guardando = false;
    btnGuardar.disabled = false;
    btnGuardar.textContent = "Guardar reporte";
  }
}

/**
- Muestra el resumen del reporte recién guardado con desglose de criticidad.
 */
function mostrarConfirmacionGuardado(reporte, calculo, segundos) {
  var tarjeta = document.getElementById("tarjeta-confirmacion");
  var textoDesglose = document.getElementById("confirmacion-desglose");
  var badgeNivel = document.getElementById("confirmacion-badge-nivel");
  var metaTiempo = document.getElementById("confirmacion-tiempo");

  var nivelMayus = String(calculo.nivel).toUpperCase();
  textoDesglose.textContent =
    reporte.id + " · Categoría " + calculo.desglose.categoria +
    " + Vía " + calculo.desglose.via +
    " + Franja " + calculo.desglose.franja +
    " = " + calculo.puntaje + " → ";

  badgeNivel.textContent = nivelMayus;
  badgeNivel.className = "badge-nivel nivel-" + String(calculo.nivel).toLowerCase();

  metaTiempo.textContent = "Tiempo de registro: " + segundos + " s (no se guarda en los datos).";
  tarjeta.hidden = false;
  tarjeta.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
- Limpia los campos para registrar un nuevo incidente.
 */
function prepararSiguienteRegistro() {
  AppEstado.cuadraAsignada = "";
  AppEstado.tipoViaSeleccionada = "";
  AppEstado.categoriaSeleccionada = "";
  AppEstado.actorSeleccionado = "";

  document.getElementById("input-cuadra").value = "";

  var botonesTipoVia = document.querySelectorAll("#grupo-tipo-via .btn-opcion");
  for (var v = 0; v < botonesTipoVia.length; v++) {
    botonesTipoVia[v].classList.remove("activo");
    botonesTipoVia[v].setAttribute("aria-pressed", "false");
  }

  var botonesCat = document.querySelectorAll("#grupo-categoria .btn-opcion");
  for (var i = 0; i < botonesCat.length; i++) {
    botonesCat[i].classList.remove("activo");
    botonesCat[i].setAttribute("aria-pressed", "false");
  }

  var botonesAct = document.querySelectorAll("#grupo-actor .btn-opcion");
  for (var j = 0; j < botonesAct.length; j++) {
    botonesAct[j].classList.remove("activo");
    botonesAct[j].setAttribute("aria-pressed", "false");
  }

  quitarFotoFormulario();

  document.getElementById("input-observaciones").value = "";
  document.getElementById("contador-obs").textContent = "0 / 140";

  AppEstado.fechaHoraManual = false;
  var ahora = obtenerFechaHoraLocal();
  document.getElementById("input-fecha-hora").value = ahora;
  document.getElementById("texto-fecha-actual").textContent = ahora.replace("T", " ");
  document.getElementById("detalle-fecha-hora").open = false;

  document.getElementById("tarjeta-confirmacion").hidden = true;
  AppEstado.inicioCronometroMs = Date.now();
}

/**
- Maneja el error QuotaExceededError sin perder el reporte recién armado.
 */
function mostrarAlertaAlmacenamientoLleno(reportePendiente) {
  var aviso = document.getElementById("aviso-quota");
  aviso.hidden = false;
  var btnExportarEmergencia = document.getElementById("btn-exportar-emergencia");
  btnExportarEmergencia.onclick = function () {
    var listaConPendiente = AppEstado.reportesLocales.concat([reportePendiente]);
    exportarReportesJSON(listaConPendiente, AppEstado.config.iniciales, true);
  };
}

/**
- Renderiza toda la vista "Registros".
 */
function renderizarVistaRegistros() {
  var todos = AppEstado.reportesActivos;

  var totalCampo = 0;
  var conteoFranja = { pico: 0, valle: 0 };
  var conteoPorCuadra = {};

  for (var i = 0; i < todos.length; i++) {
    var r = todos[i];
    if (r.origen === "campo") {
      totalCampo++;
      var fr = r._franja || deducirFranja(r.fecha_hora, AppEstado.criterios);
      if (fr === "pico") conteoFranja.pico++;
      else conteoFranja.valle++;

      conteoPorCuadra[r.cuadra] = (conteoPorCuadra[r.cuadra] || 0) + 1;
    }
  }

  document.getElementById("contador-meta-30").textContent = totalCampo + " de 30";
  document.getElementById("desglose-franjas").textContent =
    "Hora pico: " + conteoFranja.pico + " · Hora valle: " + conteoFranja.valle;

  var listaCuadrasEl = document.getElementById("desglose-cuadras");
  listaCuadrasEl.innerHTML = "";
  var cuadrasKeys = Object.keys(conteoPorCuadra);
  if (cuadrasKeys.length === 0) {
    listaCuadrasEl.innerHTML = "<span class='texto-suave'>Aún no hay registros de campo.</span>";
  } else {
    for (var cIdx = 0; cIdx < cuadrasKeys.length; cIdx++) {
      var cid = cuadrasKeys[cIdx];
      var chip = document.createElement("span");
      chip.className = "chip-conteo";
      chip.textContent = cid + ": " + conteoPorCuadra[cid];
      listaCuadrasEl.appendChild(chip);
    }
  }

  var uso = calcularUsoAlmacenamiento();
  document.getElementById("uso-almacenamiento").textContent = "Almacenamiento: " + uso.texto;
  document.getElementById("badge-total-registros").textContent = String(todos.length);

  var ordenados = todos.slice().sort(function (a, b) {
    if (a.fecha_hora < b.fecha_hora) return 1;
    if (a.fecha_hora > b.fecha_hora) return -1;
    return 0;
  });

  var contenedorLista = document.getElementById("lista-registros");
  contenedorLista.innerHTML = "";

  if (ordenados.length === 0) {
    contenedorLista.innerHTML =
      '<p class="texto-suave tarjeta-vacia">No hay reportes registrados todavía.</p>';
    return;
  }

  for (var idx = 0; idx < ordenados.length; idx++) {
    var item = ordenados[idx];
    var nivel = item.criticidad ? item.criticidad.nivel : "Bajo";
    var puntaje = item.criticidad ? item.criticidad.puntaje : 0;

    var card = document.createElement("article");
    card.className = "tarjeta-registro";

    var htmlMiniatura = "";
    if (item.foto) {
      var srcFoto = item.foto.indexOf("data:") === 0 ? item.foto : "datos/" + item.foto;
      htmlMiniatura =
        '<img class="miniatura-registro" src="' + srcFoto + '" alt="Evidencia ' + item.id + '" loading="lazy" />';
    } else {
      htmlMiniatura = '<div class="miniatura-vacia">Sin foto</div>';
    }

    var botonEliminarHtml = "";
    if (item._esLocal) {
      botonEliminarHtml =
        '<button type="button" class="btn-eliminar-registro" data-id="' + item.id + '">Eliminar</button>';
    } else {
      botonEliminarHtml = '<span class="etiqueta-precargado">Precargado</span>';
    }

    card.innerHTML =
      '<div class="registro-cabecera">' +
        '<div>' +
          '<strong>' + item.id + '</strong> · <span class="texto-suave">' + item.fecha_hora.replace("T", " ") + '</span>' +
        '</div>' +
        '<span class="badge-nivel nivel-' + String(nivel).toLowerCase() + '">' +
          nivel + ' (' + puntaje + ')' +
        '</span>' +
      '</div>' +
      '<div class="registro-cuerpo">' +
        htmlMiniatura +
        '<div class="registro-detalles">' +
          '<div><strong>Ubicación:</strong> ' + item.cuadra + '</div>' +
          '<div><strong>Categoría:</strong> ' + (ETIQUETAS_CATEGORIA[item.categoria] || item.categoria) + '</div>' +
          '<div><strong>Actor:</strong> ' + (ETIQUETAS_ACTOR[item.actor] || item.actor) + '</div>' +
          (item.observaciones ? '<div class="obs-texto">"' + item.observaciones + '"</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="registro-pie">' +
        '<span class="texto-suave">Origen: ' + item.origen + '</span>' +
        botonEliminarHtml +
      '</div>';

    contenedorLista.appendChild(card);
  }

  var botonesEliminar = contenedorLista.querySelectorAll(".btn-eliminar-registro");
  for (var b = 0; b < botonesEliminar.length; b++) {
    botonesEliminar[b].addEventListener("click", function () {
      var idBorrar = this.getAttribute("data-id");
      if (confirm("¿Seguro que deseas eliminar el reporte local " + idBorrar + "?")) {
        eliminarReporteLocal(idBorrar);
        sincronizarListaUnicaReportes();
      }
    });
  }
}

function abrirModalAjustes() {
  var modal = document.getElementById("modal-ajustes");
  document.getElementById("input-iniciales").value = AppEstado.config.iniciales || "";
  document.getElementById("select-origen").value = AppEstado.config.origen || "campo";
  document.getElementById("error-ajustes").hidden = true;
  modal.hidden = false;
}

function cerrarModalAjustes() {
  document.getElementById("modal-ajustes").hidden = true;
}

function cambiarVista(nombreVista) {
  var vistaCaptura = document.getElementById("vista-captura");
  var vistaRegistros = document.getElementById("vista-registros");
  var tabCaptura = document.getElementById("tab-captura");
  var tabRegistros = document.getElementById("tab-registros");

  if (nombreVista === "registros") {
    vistaCaptura.hidden = true;
    vistaRegistros.hidden = false;
    tabCaptura.classList.remove("activo");
    tabRegistros.classList.add("activo");
    redimensionarMapaRegistros();
  } else {
    vistaRegistros.hidden = true;
    vistaCaptura.hidden = false;
    tabRegistros.classList.remove("activo");
    tabCaptura.classList.add("activo");
    redimensionarMapaCaptura();
  }
}

/**
- Punto de entrada al cargar el DOM.
 */
document.addEventListener("DOMContentLoaded", function () {
  // 1. Cargar configuración local (iniciales y origen)
  AppEstado.config = cargarConfiguracion();
  actualizarIndicadorUsuario();

  // 2. Inicializar fecha y hora local del dispositivo
  var ahora = obtenerFechaHoraLocal();
  var inputFecha = document.getElementById("input-fecha-hora");
  inputFecha.value = ahora;
  document.getElementById("texto-fecha-actual").textContent = ahora.replace("T", " ");

  inputFecha.addEventListener("change", function () {
    AppEstado.fechaHoraManual = true;
    document.getElementById("texto-fecha-actual").textContent = inputFecha.value.replace("T", " ");
  });

  // 3. Configurar campo de dirección y botones de Tipo de vía
  var inputCuadra = document.getElementById("input-cuadra");
  inputCuadra.addEventListener("input", function () {
    if (inputCuadra.value.trim().length > 0 && AppEstado.tipoViaSeleccionada) {
      limpiarErrorCampo("error-cuadra");
    }
  });

  var botonesTipoVia = document.querySelectorAll("#grupo-tipo-via .btn-opcion");
  for (var v = 0; v < botonesTipoVia.length; v++) {
    botonesTipoVia[v].addEventListener("click", function () {
      for (var k = 0; k < botonesTipoVia.length; k++) {
        botonesTipoVia[k].classList.remove("activo");
        botonesTipoVia[k].setAttribute("aria-pressed", "false");
      }
      this.classList.add("activo");
      this.setAttribute("aria-pressed", "true");
      AppEstado.tipoViaSeleccionada = this.getAttribute("data-valor");
      if (inputCuadra.value.trim().length > 0) {
        limpiarErrorCampo("error-cuadra");
      }
    });
  }

  // 4. Configurar botones de selección única de Categoría y Actor
  var botonesCategoria = document.querySelectorAll("#grupo-categoria .btn-opcion");
  for (var i = 0; i < botonesCategoria.length; i++) {
    botonesCategoria[i].addEventListener("click", function () {
      for (var k = 0; k < botonesCategoria.length; k++) {
        botonesCategoria[k].classList.remove("activo");
        botonesCategoria[k].setAttribute("aria-pressed", "false");
      }
      this.classList.add("activo");
      this.setAttribute("aria-pressed", "true");
      AppEstado.categoriaSeleccionada = this.getAttribute("data-valor");
      limpiarErrorCampo("error-categoria");
    });
  }

  var botonesActor = document.querySelectorAll("#grupo-actor .btn-opcion");
  for (var j = 0; j < botonesActor.length; j++) {
    botonesActor[j].addEventListener("click", function () {
      for (var k = 0; k < botonesActor.length; k++) {
        botonesActor[k].classList.remove("activo");
        botonesActor[k].setAttribute("aria-pressed", "false");
      }
      this.classList.add("activo");
      this.setAttribute("aria-pressed", "true");
      AppEstado.actorSeleccionado = this.getAttribute("data-valor");
      limpiarErrorCampo("error-actor");
    });
  }

  // 5. Configurar eventos de Foto y Pixelado
  document.getElementById("btn-tomar-foto").addEventListener("click", function () {
    document.getElementById("input-foto-camara").click();
  });
  document.getElementById("btn-galeria-foto").addEventListener("click", function () {
    document.getElementById("input-foto-galeria").click();
  });
  document.getElementById("input-foto-camara").addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) procesarArchivoFoto(e.target.files[0]);
  });
  document.getElementById("input-foto-galeria").addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) procesarArchivoFoto(e.target.files[0]);
  });

  configurarHerramientaPixelado();

  document.getElementById("btn-deshacer-pixel").addEventListener("click", function () {
    if (historialCanvas.length > 1) {
      historialCanvas.pop();
      var canvas = document.getElementById("canvas-foto");
      var anterior = historialCanvas[historialCanvas.length - 1];
      canvas.getContext("2d").putImageData(anterior, 0, 0);
    }
  });

  document.getElementById("btn-quitar-foto").addEventListener("click", quitarFotoFormulario);

  // 6. Contador de caracteres en Observaciones
  var inputObs = document.getElementById("input-observaciones");
  inputObs.addEventListener("input", function () {
    document.getElementById("contador-obs").textContent = inputObs.value.length + " / 140";
  });

  // 7. Botones principales del formulario y navegación
  document.getElementById("btn-usar-gps").addEventListener("click", solicitarGpsDispositivo);
  document.getElementById("btn-guardar").addEventListener("click", guardarNuevoReporte);
  document.getElementById("btn-registrar-otro").addEventListener("click", prepararSiguienteRegistro);

  document.getElementById("tab-captura").addEventListener("click", function () {
    cambiarVista("captura");
  });
  document.getElementById("tab-registros").addEventListener("click", function () {
    cambiarVista("registros");
  });

  // 8. Ajustes (⚙️)
  document.getElementById("btn-abrir-ajustes").addEventListener("click", abrirModalAjustes);
  document.getElementById("btn-cerrar-ajustes").addEventListener("click", cerrarModalAjustes);
  document.getElementById("btn-guardar-ajustes").addEventListener("click", function () {
    var res = guardarConfiguracion({
      iniciales: document.getElementById("input-iniciales").value,
      origen: document.getElementById("select-origen").value
    });
    if (!res.ok) {
      var errEl = document.getElementById("error-ajustes");
      errEl.textContent = res.mensaje;
      errEl.hidden = false;
      return;
    }
    AppEstado.config = res.config;
    actualizarIndicadorUsuario();
    cerrarModalAjustes();
  });

  // 9. Exportar e Importar en Vista Registros
  document.getElementById("btn-exportar-con-fotos").addEventListener("click", function () {
    exportarReportesJSON(AppEstado.reportesLocales, AppEstado.config.iniciales, true);
  });
  document.getElementById("btn-exportar-sin-fotos").addEventListener("click", function () {
    exportarReportesJSON(AppEstado.reportesLocales, AppEstado.config.iniciales, false);
  });
  document.getElementById("btn-exportar-zip").addEventListener("click", function () {
    exportarPaqueteZIP(AppEstado.reportesLocales, AppEstado.config.iniciales).catch(function (err) {
      alert(err.message);
    });
  });

  document.getElementById("btn-importar-json").addEventListener("click", function () {
    document.getElementById("input-importar-json").click();
  });

  document.getElementById("input-importar-json").addEventListener("change", function (e) {
    var archivo = e.target.files && e.target.files[0];
    if (!archivo) return;

    var lector = new FileReader();
    lector.onload = function (ev) {
      // Registrar las ubicaciones del JSON importado para que sean válidas
      try {
        var datosImp = JSON.parse(ev.target.result);
        var listaImp = Array.isArray(datosImp) ? datosImp : (datosImp && datosImp.reportes) || [];
        for (var m = 0; m < listaImp.length; m++) {
          if (listaImp[m] && listaImp[m].cuadra) {
            registrarUbicacionEnVias(listaImp[m].cuadra, listaImp[m].tipo_via);
          }
        }
      } catch (errParse) {
        // El validador de importarReportesDesdeTexto mostrará el error de formato
      }

      var res = importarReportesDesdeTexto(
        ev.target.result,
        AppEstado.reportesPrecargados,
        AppEstado.criterios,
        AppEstado.vias
      );

      var cajaResultado = document.getElementById("resultado-importacion");
      cajaResultado.hidden = false;

      if (!res.ok) {
        cajaResultado.className = "aviso-alerta";
        cajaResultado.textContent = res.mensaje;
        return;
      }

      cajaResultado.className = "aviso-info";
      var html =
        "<strong>" + res.nuevos + " nuevos · " + res.repetidos + " repetidos · " + res.invalidos + " inválidos</strong>";

      if (res.conflictos > 0) {
        html += "<br><strong>Conflictos (" + res.conflictos + "):</strong><ul>";
        for (var c = 0; c < res.detallesConflictos.length; c++) {
          html += "<li>" + res.detallesConflictos[c].id + ": " + res.detallesConflictos[c].motivo + "</li>";
        }
        html += "</ul>";
      }

      if (res.detallesInvalidos.length > 0) {
        html += "<br><strong>Motivos de inválidos:</strong><ul>";
        for (var inv = 0; inv < res.detallesInvalidos.length; inv++) {
          html += "<li>" + res.detallesInvalidos[inv].id + ": " + res.detallesInvalidos[inv].motivo + "</li>";
        }
        html += "</ul>";
      }

      cajaResultado.innerHTML = html;
      sincronizarListaUnicaReportes();
      e.target.value = "";
    };
    lector.readAsText(archivo, "utf-8");
  });

  // 10. Cargar criterios y reportes precargados, y arrancar mapas
  cargarDatosIniciales()
    .then(function (datos) {
      AppEstado.criterios = datos[0];
      AppEstado.reportesPrecargados = Array.isArray(datos[1]) ? datos[1] : [];

      document.getElementById("nombre-zona-header").textContent = AppEstado.vias.zona.nombre;

      var mapaCapOk = iniciarMapaCaptura("mapa-captura", AppEstado.vias, function (lat, lng) {
        fijarUbicacion(lat, lng, null);
      });
      var mapaRegOk = iniciarMapaRegistros("mapa-registros", AppEstado.vias);

      if (!mapaCapOk || !mapaRegOk) {
        document.getElementById("aviso-sin-mapa").hidden = false;
      }

      sincronizarListaUnicaReportes();

      if (!AppEstado.config.iniciales) {
        abrirModalAjustes();
      }

      solicitarGpsDispositivo();
    })
    .catch(function (err) {
      console.error("Error cargando JSON:", err);
      var avisoFetch = document.getElementById("aviso-fetch");
      avisoFetch.hidden = false;
    });
});

function actualizarIndicadorUsuario() {
  var badge = document.getElementById("indicador-iniciales");
  if (AppEstado.config.iniciales) {
    badge.textContent = AppEstado.config.iniciales + " · " + AppEstado.config.origen;
  } else {
    badge.textContent = "Configurar iniciales";
  }
}