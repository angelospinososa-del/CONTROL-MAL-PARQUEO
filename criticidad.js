/* ============================================================================
 * ARCHIVO: criticidad.js
 * RESPONSABILIDAD: Lógica pura para deducir la franja horaria y calcular el
 * índice de criticidad de un reporte. No usa DOM, ni fetch, ni localStorage.
 * ============================================================================ */

/**
 * Convierte una cadena de hora "HH:MM" a minutos totales desde las 00:00.
 * Entrada: textoHora (string, ej. "11:40")
 * Salida: número entero de minutos (ej. 700)
 */
function horaAMinutos(textoHora) {
  // Paso 1: Validar que el parámetro sea un texto con formato "HH:MM"
  if (typeof textoHora !== "string" || !/^\d{2}:\d{2}$/.test(textoHora.trim())) {
    throw new Error("Formato de hora inválido: '" + textoHora + "'. Se esperaba HH:MM.");
  }

  // Paso 2: Separar horas y minutos y convertirlos a enteros
  var partes = textoHora.trim().split(":");
  var horas = parseInt(partes[0], 10);
  var minutos = parseInt(partes[1], 10);

  // Condición: Verificar rangos reales de reloj (00 a 23 horas, 00 a 59 minutos)
  if (horas < 0 || horas > 23 || minutos < 0 || minutos > 59) {
    throw new Error("Hora fuera de rango válido: '" + textoHora + "'.");
  }

  // Salida: Total de minutos transcurridos en el día
  return horas * 60 + minutos;
}

/**
 * Deduce si una fecha y hora corresponde a franja "pico" o "valle" según criterios.json.
 * Regla de límites: inicio incluido (>=), fin excluido (<). Ejemplo: 11:30 es pico; 14:00 es valle.
 * Entradas:
 *   - fechaHora: string en formato "AAAA-MM-DDTHH:MM" (o "HH:MM")
 *   - criterios: objeto cargado desde datos/criterios.json
 * Salida: "pico" o "valle"
 */
function deducirFranja(fechaHora, criterios) {
  // Paso 1: Validar entradas obligatorias
  if (!fechaHora || typeof fechaHora !== "string") {
    throw new Error("Falta la fecha y hora del reporte para deducir la franja.");
  }
  if (!criterios || !Array.isArray(criterios.horas_pico)) {
    throw new Error("El objeto criterios no contiene el arreglo 'horas_pico'.");
  }

  // Paso 2: Extraer la porción "HH:MM" si viene con fecha completa "AAAA-MM-DDTHH:MM"
  var soloHora = fechaHora.indexOf("T") !== -1 ? fechaHora.split("T")[1] : fechaHora;
  var minutosReporte = horaAMinutos(soloHora);

  // Paso 3 (Repetición): Revisar cada rango definido en criterios.horas_pico
  for (var i = 0; i < criterios.horas_pico.length; i++) {
    var rango = criterios.horas_pico[i];
    var limites = rango.split("-");

    if (limites.length !== 2) {
      throw new Error("Rango horario mal formado en criterios.json: '" + rango + "'.");
    }

    var inicioMin = horaAMinutos(limites[0]);
    var finMin = horaAMinutos(limites[1]);

    // Condición: Inicio incluido y fin excluido
    if (minutosReporte >= inicioMin && minutosReporte < finMin) {
      return "pico";
    }
  }

  // Salida: Si no coincidió con ningún rango pico, pertenece a hora valle
  return "valle";
}

/**
 * Calcula el puntaje, nivel, franja y desglose de criticidad de un reporte.
 * Entradas:
 *   - reporte: objeto con al menos { categoria, cuadra, fecha_hora }
 *   - criterios: objeto cargado desde datos/criterios.json
 *   - vias: objeto cargado desde datos/vias.json
 * Salida:
 *   - { puntaje, nivel, franja, desglose: { categoria, via, franja } }
 */
function calcularCriticidad(reporte, criterios, vias) {
  // Paso 1: Validar que los objetos principales existan
  if (!reporte || typeof reporte !== "object") {
    throw new Error("Reporte inválido o vacío.");
  }
  if (!criterios || !criterios.categoria || !criterios.via || !criterios.franja || !criterios.niveles) {
    throw new Error("Estructura de criterios.json incompleta.");
  }
  if (!vias || !Array.isArray(vias.cuadras)) {
    throw new Error("Estructura de vias.json incompleta: falta el arreglo 'cuadras'.");
  }

  // Paso 2: Obtener peso de la categoría (error claro si falta o no existe)
  if (!reporte.categoria) {
    throw new Error("El reporte no tiene categoría asignada.");
  }
  var pesoCategoria = criterios.categoria[reporte.categoria];
  if (typeof pesoCategoria !== "number") {
    throw new Error("Categoría desconocida en criterios.json: '" + reporte.categoria + "'.");
  }

  // Paso 3 (Repetición): Buscar la cuadra en vias.json para obtener su tipo de vía
  if (!reporte.cuadra) {
    throw new Error("El reporte no tiene cuadra asignada.");
  }
  var cuadraEncontrada = null;
  for (var i = 0; i < vias.cuadras.length; i++) {
    if (vias.cuadras[i].id === reporte.cuadra) {
      cuadraEncontrada = vias.cuadras[i];
      break;
    }
  }

  // Condición: Si la cuadra no existe en vias.json, lanzar error explícito
  if (!cuadraEncontrada) {
    throw new Error("Cuadra desconocida en vias.json: '" + reporte.cuadra + "'.");
  }

  var tipoVia = cuadraEncontrada.tipo_via;
  var pesoVia = criterios.via[tipoVia];
  if (typeof pesoVia !== "number") {
    throw new Error("Tipo de vía desconocido en criterios.json: '" + tipoVia + "'.");
  }

  // Paso 4: Deducir la franja una sola vez y obtener su peso
  var franja = deducirFranja(reporte.fecha_hora, criterios);
  var pesoFranja = criterios.franja[franja];
  if (typeof pesoFranja !== "number") {
    throw new Error("Franja desconocida en criterios.json: '" + franja + "'.");
  }

  // Paso 5: Sumar los tres componentes una sola vez
  var puntaje = pesoCategoria + pesoVia + pesoFranja;

  // Paso 6 (Repetición con condición): Determinar el nivel según los rangos de criterios.niveles
  var nivel = null;
  var nombresNiveles = Object.keys(criterios.niveles);
  var nivelSuperior = null;
  var maxGlobal = -Infinity;

  for (var j = 0; j < nombresNiveles.length; j++) {
    var nombre = nombresNiveles[j];
    var rangoNivel = criterios.niveles[nombre];
    var min = rangoNivel[0];
    var max = rangoNivel[1];

    if (max > maxGlobal) {
      maxGlobal = max;
      nivelSuperior = nombre;
    }

    if (puntaje >= min && puntaje <= max) {
      nivel = nombre;
    }
  }

  // Condición de respaldo: Si en sustentación suben un peso y el puntaje supera el techo, asignar nivel superior
  if (nivel === null && puntaje > maxGlobal && nivelSuperior !== null) {
    nivel = nivelSuperior;
  }

  if (nivel === null) {
    throw new Error("El puntaje " + puntaje + " no encaja en ningún rango de criterios.niveles.");
  }

  // Salida: Objeto completo con puntaje, nivel, franja y desglose
  return {
    puntaje: puntaje,
    nivel: nivel,
    franja: franja,
    desglose: {
      categoria: pesoCategoria,
      via: pesoVia,
      franja: pesoFranja
    }
  };
}

/**
 * Recalcula la criticidad de una lista completa de reportes usando las reglas vigentes.
 * Entradas: listaReportes (Array), criterios (Object), vias (Object)
 * Salida: Nuevo arreglo de reportes con su propiedad 'criticidad' actualizada.
 */
function recalcularTodosLosReportes(listaReportes, criterios, vias) {
  if (!Array.isArray(listaReportes)) {
    return [];
  }

  var resultado = [];
  for (var i = 0; i < listaReportes.length; i++) {
    var original = listaReportes[i];
    // Copiar propiedades del reporte sin mutar el objeto de entrada
    var copia = Object.assign({}, original);
    var calc = calcularCriticidad(copia, criterios, vias);
    copia.criticidad = {
      puntaje: calc.puntaje,
      nivel: calc.nivel
    };
    // Guardamos también franja y desglose calculados en memoria para uso interno
    copia._franja = calc.franja;
    copia._desglose = calc.desglose;
    resultado.push(copia);
  }
  return resultado;
}
