"use strict";

/**
 * ============================================================
 * PRO ACS
 * GRÁFICAS DE DEMANDA Y RESULTADOS
 * Versión 3.0.0
 * ============================================================
 *
 * Responsabilidades:
 *
 * - Mostrar el perfil horario de demanda en la pantalla de entrada.
 * - Representar una única serie de barras en litros y un eje derecho
 *   con la energía equivalente de esas mismas barras.
 * - Dibujar por separado las gráficas de carga, energía y el cronograma de funcionamiento.
 * - Exportar cualquiera de las cuatro gráficas para el informe PDF.
 *
 * Este archivo no modifica el motor de simulación.
 */


/* ============================================================
 * CONFIGURACIÓN
 * ============================================================ */

const ACS_CHARTS_CONFIG = Object.freeze({
  VERSION: "3.1.0",

  MINIMUM_WIDTH_PX: 960,
  DEMAND_MINIMUM_WIDTH_PX: 720,

  HEIGHT_PX: 420,
  DEMAND_HEIGHT_PX: 300,

  DEVICE_PIXEL_RATIO_LIMIT: 2,

  PADDING: Object.freeze({
    top: 34,
    right: 72,
    bottom: 58,
    left: 72
  }),

  COLORS: Object.freeze({
    demand: "#7c3aed",
    demandSoft: "#c4b5fd",

    tank1: "#2563eb",
    tank2: "#16a34a",

    tank1Energy: "#93c5fd",
    tank2Energy: "#86efac",

    generatorPower: "#dc2626",
    exchanger1Power: "#1d4ed8",
    exchanger2Power: "#15803d",

    generatorMaximum: "#f87171",
    exchanger1Maximum: "#60a5fa",
    exchanger2Maximum: "#4ade80",

    comfortTightReference: "#d97706",
    comfortComfortableReference: "#15803d",

    axis: "#64748b",
    grid: "#e2e8f0",
    text: "#334155",
    background: "#ffffff",
    tooltipBackground: "#0f172a",
    tooltipText: "#ffffff"
  })
});


/* ============================================================
 * ESTADO
 * ============================================================ */

const ACSChartsState = {
  currentView: "load",

  chartData: null,

  demandProfileData: null,

  canvases: new Map(),

  contexts: new Map(),

  resizeFrame: null,

  demandHoverHandler: null,

  demandLeaveHandler: null,

  powerHoverHandler: null,

  powerLeaveHandler: null
};


/* ============================================================
 * ERRORES
 * ============================================================ */

class ACSChartsError extends Error {
  constructor(
    message,
    details = null
  ) {
    super(message);

    this.name = "ACSChartsError";
    this.details = details;
  }
}


/* ============================================================
 * UTILIDADES
 * ============================================================ */

function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}


function finiteOrFallbackForChart(
  value,
  fallback = 0
) {
  return isFiniteNumber(value)
    ? value
    : fallback;
}


function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}


function formatNumber(
  value,
  maximumFractionDigits = 1
) {
  if (!isFiniteNumber(value)) {
    return "—";
  }

  return value.toLocaleString(
    "es-ES",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits
    }
  );
}


function getFiniteValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter(
    isFiniteNumber
  );
}


function getMaximumFromSeries(
  seriesCollection,
  fallback = 1
) {
  const values =
    seriesCollection.flatMap(
      series =>
        getFiniteValues(series)
    );

  if (values.length === 0) {
    return fallback;
  }

  return Math.max(
    fallback,
    ...values
  );
}


function getNiceMaximum(value) {
  if (
    !isFiniteNumber(value) ||
    value <= 0
  ) {
    return 1;
  }

  const exponent =
    Math.floor(
      Math.log10(value)
    );

  const magnitude =
    10 ** exponent;

  const normalized =
    value / magnitude;

  let niceNormalized;

  if (normalized <= 1) {
    niceNormalized = 1;
  } else if (normalized <= 2) {
    niceNormalized = 2;
  } else if (normalized <= 5) {
    niceNormalized = 5;
  } else {
    niceNormalized = 10;
  }

  return niceNormalized * magnitude;
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function createDefaultHours() {
  return Array.from(
    { length: 24 },
    (_value, hourIndex) => ({
      hourIndex,
      label:
        `${String(hourIndex).padStart(2, "0")}:00`
    })
  );
}


/**
 * Energía necesaria para calentar un litro de agua.
 *
 * 1,163 Wh/(L·K) = 0,001163 kWh/(L·K)
 */


/**
 * Comprueba si una colección de series contiene al menos un valor finito.
 */
function hasUsableSeriesCollection(collection) {
  if (!collection || typeof collection !== "object") {
    return false;
  }

  return Object.values(collection).some(
    series =>
      Array.isArray(series) &&
      series.some(isFiniteNumber)
  );
}


function hasNonZeroSeriesCollection(collection, epsilon = 1e-9) {
  if (!collection || typeof collection !== "object") {
    return false;
  }

  return Object.values(collection).some(
    series =>
      Array.isArray(series) &&
      series.some(
        value =>
          isFiniteNumber(value) &&
          Math.abs(value) > epsilon
      )
  );
}


/**
 * Expande 24 valores horarios a una serie minuto a minuto.
 * Cada valor horario se interpreta como potencia media durante esa hora.
 */
function expandHourlySeriesToMinutes(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .slice(0, 24)
    .flatMap(value =>
      Array(60).fill(
        finiteOrFallbackForChart(value, 0)
      )
    );
}


/**
 * Normaliza los datos recibidos por las gráficas de resultados.
 *
 * Prioridad:
 * 1. Series minuto a minuto reales.
 * 2. Series horarias del bloque 7.
 * 3. Energía horaria convertida en potencia media (kWh/h = kW).
 */
function normalizeResultsChartData(chartData) {
  const normalized = {
    ...chartData,
    hours:
      Array.isArray(chartData?.hours) &&
      chartData.hours.length === 24
        ? chartData.hours
        : createDefaultHours(),
    energy: {
      ...(chartData?.energy || {})
    },
    load: {
      ...(chartData?.load || {})
    }
  };

  const energy = normalized.energy;
  const load = normalized.load;

  const finalLoadByTank =
    load.finalLoadByTank &&
    typeof load.finalLoadByTank === "object"
      ? load.finalLoadByTank
      : {};

  const finalLoadHasMovement =
    hasNonZeroSeriesCollection(
      finalLoadByTank
    );

  if (
    !hasUsableSeriesCollection(
      load.continuousLoadByTank
    ) ||
    (
      !hasNonZeroSeriesCollection(
        load.continuousLoadByTank
      ) &&
      finalLoadHasMovement
    )
  ) {
    load.continuousLoadByTank =
      Object.fromEntries(
        Object.entries(finalLoadByTank).map(
          ([tankId, values]) => [
            tankId,
            expandHourlySeriesToMinutes(values)
          ]
        )
      );
  }

  const deliveredEnergyByTank =
    energy.deliveredEnergyByTank &&
    typeof energy.deliveredEnergyByTank === "object"
      ? energy.deliveredEnergyByTank
      : {};

  if (
    !hasUsableSeriesCollection(
      energy.exchangerPowerByTankKW
    ) ||
    (
      !hasNonZeroSeriesCollection(
        energy.exchangerPowerByTankKW
      ) &&
      hasNonZeroSeriesCollection(
        deliveredEnergyByTank
      )
    )
  ) {
    energy.exchangerPowerByTankKW =
      Object.fromEntries(
        Object.entries(deliveredEnergyByTank).map(
          ([tankId, hourlyEnergyKWh]) => [
            tankId,
            expandHourlySeriesToMinutes(hourlyEnergyKWh)
          ]
        )
      );
  }

  const deliveredTotalHasEnergy =
    Array.isArray(
      energy.totalDeliveredEnergyKWh
    ) &&
    energy.totalDeliveredEnergyKWh.some(
      value =>
        isFiniteNumber(value) &&
        Math.abs(value) > 1e-9
    );

  const generatorHasPower =
    Array.isArray(energy.generatorPowerKW) &&
    energy.generatorPowerKW.some(
      value =>
        isFiniteNumber(value) &&
        Math.abs(value) > 1e-9
    );

  if (
    !Array.isArray(energy.generatorPowerKW) ||
    !energy.generatorPowerKW.some(isFiniteNumber) ||
    (
      !generatorHasPower &&
      (
        deliveredTotalHasEnergy ||
        hasNonZeroSeriesCollection(
          deliveredEnergyByTank
        )
      )
    )
  ) {
    let hourlyGeneratorPowerKW = [];

    if (
      Array.isArray(energy.totalDeliveredEnergyKWh) &&
      energy.totalDeliveredEnergyKWh.length > 0
    ) {
      hourlyGeneratorPowerKW =
        energy.totalDeliveredEnergyKWh;
    } else {
      const tankSeries =
        Object.values(deliveredEnergyByTank)
          .filter(Array.isArray);

      hourlyGeneratorPowerKW =
        Array.from(
          { length: 24 },
          (_value, hourIndex) =>
            tankSeries.reduce(
              (total, series) =>
                total +
                finiteOrFallbackForChart(
                  series[hourIndex],
                  0
                ),
              0
            )
        );
    }

    energy.generatorPowerKW =
      expandHourlySeriesToMinutes(
        hourlyGeneratorPowerKW
      );
  }

  return normalized;
}

function calculateEquivalentEnergyKWh(
  volumeL,
  referenceTemperatureC,
  networkTemperatureC
) {
  if (
    !isFiniteNumber(volumeL) ||
    !isFiniteNumber(referenceTemperatureC) ||
    !isFiniteNumber(networkTemperatureC)
  ) {
    return null;
  }

  const temperatureDifference =
    Math.max(
      0,
      referenceTemperatureC -
      networkTemperatureC
    );

  return (
    volumeL *
    temperatureDifference *
    0.001163
  );
}


/* ============================================================
 * IDENTIFICADORES DE CANVAS Y LEYENDAS
 * ============================================================ */

function getCanvasIdForView(view) {
  const ids = {
    demand: "demandProfileChart",
    load: "resultsChartLoad",
    hourlyEnergy: "resultsChartHourlyEnergy",
    power: "resultsChartPower"
  };

  return ids[view] || null;
}


function getLegendIdForView(view) {
  const ids = {
    demand: "demandProfileChartLegend",
    load: "chartLegendLoad",
    hourlyEnergy: "chartLegendHourlyEnergy",
    power: "chartLegendPower"
  };

  return ids[view] || null;
}


/* ============================================================
 * CANVAS
 * ============================================================ */

function prepareCanvas(view) {
  const canvasId =
    getCanvasIdForView(view);

  if (!canvasId) {
    throw new ACSChartsError(
      `Vista gráfica no válida: ${view}.`
    );
  }

  const canvas =
    document.getElementById(
      canvasId
    );

  if (!canvas) {
    throw new ACSChartsError(
      `No se ha encontrado el canvas #${canvasId}.`
    );
  }

  const container =
    canvas.closest(
      ".chart-container"
    );

  const minimumWidth =
    view === "demand"
      ? ACS_CHARTS_CONFIG
          .DEMAND_MINIMUM_WIDTH_PX
      : ACS_CHARTS_CONFIG
          .MINIMUM_WIDTH_PX;

  const cssHeight =
    view === "demand"
      ? ACS_CHARTS_CONFIG
          .DEMAND_HEIGHT_PX
      : ACS_CHARTS_CONFIG
          .HEIGHT_PX;

  const availableWidth =
    container
      ? container.clientWidth - 22
      : minimumWidth;

  const cssWidth =
    Math.max(
      minimumWidth,
      availableWidth
    );

  const pixelRatio =
    Math.min(
      window.devicePixelRatio || 1,
      ACS_CHARTS_CONFIG
        .DEVICE_PIXEL_RATIO_LIMIT
    );

  canvas.width =
    Math.round(
      cssWidth *
      pixelRatio
    );

  canvas.height =
    Math.round(
      cssHeight *
      pixelRatio
    );

  canvas.style.width =
    `${cssWidth}px`;

  canvas.style.height =
    `${cssHeight}px`;

  const context =
    canvas.getContext("2d");

  if (!context) {
    throw new ACSChartsError(
      `No se ha podido obtener el contexto 2D de #${canvasId}.`
    );
  }

  context.setTransform(
    pixelRatio,
    0,
    0,
    pixelRatio,
    0,
    0
  );

  ACSChartsState.canvases.set(
    view,
    canvas
  );

  ACSChartsState.contexts.set(
    view,
    context
  );

  return {
    canvas,
    context,
    width: cssWidth,
    height: cssHeight
  };
}


function clearCanvas(
  context,
  width,
  height
) {
  context.clearRect(
    0,
    0,
    width,
    height
  );

  context.fillStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .background;

  context.fillRect(
    0,
    0,
    width,
    height
  );
}


/* ============================================================
 * ÁREA DE GRÁFICA
 * ============================================================ */

function getPlotArea(
  width,
  height
) {
  const padding =
    ACS_CHARTS_CONFIG
      .PADDING;

  return {
    left:
      padding.left,

    right:
      width -
      padding.right,

    top:
      padding.top,

    bottom:
      height -
      padding.bottom,

    width:
      width -
      padding.left -
      padding.right,

    height:
      height -
      padding.top -
      padding.bottom
  };
}


function getHourCenterX(
  hourIndex,
  plot
) {
  return (
    plot.left +
    plot.width *
    (
      hourIndex + 0.5
    ) /
    24
  );
}


function getSeriesX(
  index,
  pointCount,
  plot
) {
  if (pointCount <= 1) {
    return plot.left;
  }

  return (
    plot.left +
    plot.width *
    index /
    (pointCount - 1)
  );
}


function valueToY(
  value,
  minimum,
  maximum,
  plot
) {
  const safeRange =
    maximum - minimum || 1;

  const normalized =
    clamp(
      (
        value -
        minimum
      ) /
      safeRange,
      0,
      1
    );

  return (
    plot.bottom -
    normalized *
    plot.height
  );
}


/* ============================================================
 * EJES Y REJILLA
 * ============================================================ */

function drawHorizontalAxis(
  context,
  plot,
  hours
) {
  context.save();

  context.strokeStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .axis;

  context.lineWidth = 1;

  context.beginPath();

  context.moveTo(
    plot.left,
    plot.bottom
  );

  context.lineTo(
    plot.right,
    plot.bottom
  );

  context.stroke();

  context.fillStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .axis;

  context.font =
    "11px system-ui, sans-serif";

  context.textAlign =
    "center";

  context.textBaseline =
    "top";

  hours.forEach(
    (
      hour,
      index
    ) => {
      if (
        index % 2 !== 0 &&
        index !== 23
      ) {
        return;
      }

      const x =
        getHourCenterX(
          index,
          plot
        );

      context.fillText(
        hour.label,
        x,
        plot.bottom + 12
      );
    }
  );

  context.fillStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .text;

  context.font =
    "600 12px system-ui, sans-serif";

  context.fillText(
    "Tiempo (h)",
    (
      plot.left +
      plot.right
    ) / 2,
    plot.bottom + 38
  );

  context.restore();
}


function drawVerticalAxis(
  context,
  plot,
  options
) {
  const {
    minimum,
    maximum,
    label,
    side = "left",
    divisions = 5,
    formatter =
      value =>
        formatNumber(
          value,
          1
        )
  } = options;

  const isRight =
    side === "right";

  const axisX =
    isRight
      ? plot.right
      : plot.left;

  context.save();

  context.strokeStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .axis;

  context.fillStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .axis;

  context.lineWidth = 1;

  context.font =
    "11px system-ui, sans-serif";

  context.textBaseline =
    "middle";

  context.textAlign =
    isRight
      ? "left"
      : "right";

  context.beginPath();

  context.moveTo(
    axisX,
    plot.top
  );

  context.lineTo(
    axisX,
    plot.bottom
  );

  context.stroke();

  for (
    let index = 0;
    index <= divisions;
    index += 1
  ) {
    const fraction =
      index / divisions;

    const value =
      maximum -
      (
        maximum -
        minimum
      ) *
      fraction;

    const y =
      plot.top +
      plot.height *
      fraction;

    context.fillText(
      formatter(value),
      isRight
        ? axisX + 9
        : axisX - 9,
      y
    );

    if (!isRight) {
      context.strokeStyle =
        ACS_CHARTS_CONFIG
          .COLORS
          .grid;

      context.beginPath();

      context.moveTo(
        plot.left,
        y
      );

      context.lineTo(
        plot.right,
        y
      );

      context.stroke();
    }
  }

  context.save();

  context.translate(
    isRight
      ? axisX + 49
      : axisX - 49,
    (
      plot.top +
      plot.bottom
    ) / 2
  );

  context.rotate(
    isRight
      ? Math.PI / 2
      : -Math.PI / 2
  );

  context.textAlign =
    "center";

  context.font =
    "600 12px system-ui, sans-serif";

  context.fillStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .text;

  context.fillText(
    label,
    0,
    0
  );

  context.restore();
  context.restore();
}


/* ============================================================
 * ELEMENTOS GRÁFICOS
 * ============================================================ */

function drawBarSeries(
  context,
  values,
  options
) {
  const {
    plot,
    minimum = 0,
    maximum,
    color,
    opacity = 1,
    widthFactor = 0.72
  } = options;

  const hourWidth =
    plot.width / 24;

  const barWidth =
    hourWidth *
    widthFactor;

  context.save();

  context.fillStyle =
    color;

  context.globalAlpha =
    opacity;

  values.forEach(
    (
      value,
      hourIndex
    ) => {
      if (!isFiniteNumber(value)) {
        return;
      }

      const centerX =
        getHourCenterX(
          hourIndex,
          plot
        );

      const y =
        valueToY(
          value,
          minimum,
          maximum,
          plot
        );

      const height =
        Math.max(
          0,
          plot.bottom - y
        );

      context.fillRect(
        centerX - barWidth / 2,
        y,
        barWidth,
        height
      );
    }
  );

  context.restore();
}


function drawStackedBarSeries(
  context,
  seriesCollection,
  options
) {
  const {
    plot,
    maximum,
    colors
  } = options;

  const hourWidth =
    plot.width / 24;

  const barWidth =
    hourWidth * 0.78;

  for (
    let hourIndex = 0;
    hourIndex < 24;
    hourIndex += 1
  ) {
    let accumulatedValue = 0;

    seriesCollection.forEach(
      (
        series,
        seriesIndex
      ) => {
        const value =
          finiteOrFallbackForChart(
            series[hourIndex],
            0
          );

        if (value <= 0) {
          return;
        }

        const centerX =
          getHourCenterX(
            hourIndex,
            plot
          );

        const yTop =
          valueToY(
            accumulatedValue + value,
            0,
            maximum,
            plot
          );

        const yBottom =
          valueToY(
            accumulatedValue,
            0,
            maximum,
            plot
          );

        context.fillStyle =
          colors[seriesIndex];

        context.fillRect(
          centerX - barWidth / 2,
          yTop,
          barWidth,
          Math.max(
            0,
            yBottom - yTop
          )
        );

        accumulatedValue += value;
      }
    );
  }
}


function drawLineSeries(
  context,
  values,
  options
) {
  const {
    plot,
    minimum,
    maximum,
    color,
    lineWidth = 2.5,
    drawPoints = false
  } = options;

  context.save();

  context.strokeStyle =
    color;

  context.fillStyle =
    color;

  context.lineWidth =
    lineWidth;

  context.lineJoin =
    "round";

  context.lineCap =
    "round";

  context.beginPath();

  let started = false;

  values.forEach(
    (
      value,
      index
    ) => {
      if (!isFiniteNumber(value)) {
        started = false;
        return;
      }

      const x =
        getSeriesX(
          index,
          values.length,
          plot
        );

      const y =
        valueToY(
          value,
          minimum,
          maximum,
          plot
        );

      if (!started) {
        context.moveTo(
          x,
          y
        );

        started = true;
      } else {
        context.lineTo(
          x,
          y
        );
      }
    }
  );

  context.stroke();

  if (drawPoints) {
    values.forEach(
      (
        value,
        index
      ) => {
        if (!isFiniteNumber(value)) {
          return;
        }

        const x =
          getSeriesX(
            index,
            values.length,
            plot
          );

        const y =
          valueToY(
            value,
            minimum,
            maximum,
            plot
          );

        context.beginPath();

        context.arc(
          x,
          y,
          2.8,
          0,
          Math.PI * 2
        );

        context.fill();
      }
    );
  }

  context.restore();
}


function drawReferenceLine(
  context,
  value,
  options
) {
  const {
    plot,
    minimum,
    maximum,
    color,
    label,
    dash = [6, 5]
  } = options;

  if (!isFiniteNumber(value)) {
    return;
  }

  if (
    value < minimum ||
    value > maximum
  ) {
    return;
  }

  const y =
    valueToY(
      value,
      minimum,
      maximum,
      plot
    );

  context.save();

  context.strokeStyle =
    color;

  context.fillStyle =
    color;

  context.lineWidth = 1.1;

  context.setLineDash(
    dash
  );

  context.beginPath();

  context.moveTo(
    plot.left,
    y
  );

  context.lineTo(
    plot.right,
    y
  );

  context.stroke();

  context.setLineDash([]);

  if (label) {
    context.font =
      "600 11px system-ui, sans-serif";

    context.textAlign =
      "right";

    context.textBaseline =
      "bottom";

    context.fillText(
      label,
      plot.right - 5,
      y - 4
    );
  }

  context.restore();
}


/* ============================================================
 * LEYENDA
 * ============================================================ */

function renderLegend(
  items,
  view = ACSChartsState.currentView
) {
  const legendId =
    getLegendIdForView(view);

  if (!legendId) {
    return;
  }

  const container =
    document.getElementById(
      legendId
    );

  if (!container) {
    return;
  }

  container.innerHTML =
    items
      .map(
        item => `
          <span class="chart-legend__item">
            <span
              class="chart-legend__marker"
              style="background:${escapeHtml(
                item.color
              )}"
            ></span>

            ${escapeHtml(
              item.label
            )}
          </span>
        `
      )
      .join("");
}


/* ============================================================
 * TOOLTIP DEL PERFIL DE DEMANDA
 * ============================================================ */

function getOrCreateDemandTooltip(
  canvas
) {
  const container =
    canvas.closest(
      ".chart-container"
    );

  if (!container) {
    return null;
  }

  if (
    window.getComputedStyle(container)
      .position === "static"
  ) {
    container.style.position =
      "relative";
  }

  let tooltip =
    container.querySelector(
      ".acs-demand-chart-tooltip"
    );

  if (!tooltip) {
    tooltip =
      document.createElement("div");

    tooltip.className =
      "acs-demand-chart-tooltip";

    Object.assign(
      tooltip.style,
      {
        position: "absolute",
        display: "none",
        pointerEvents: "none",
        zIndex: "5",
        padding: "0.55rem 0.7rem",
        borderRadius: "0.55rem",
        background:
          ACS_CHARTS_CONFIG
            .COLORS
            .tooltipBackground,
        color:
          ACS_CHARTS_CONFIG
            .COLORS
            .tooltipText,
        font:
          "12px system-ui, sans-serif",
        lineHeight: "1.4",
        boxShadow:
          "0 8px 24px rgba(15, 23, 42, 0.22)",
        whiteSpace: "nowrap"
      }
    );

    container.appendChild(
      tooltip
    );
  }

  return tooltip;
}


function attachDemandTooltip(
  canvas,
  plot,
  demandProfileData
) {
  const tooltip =
    getOrCreateDemandTooltip(
      canvas
    );

  if (!tooltip) {
    return;
  }

  if (
    ACSChartsState.demandHoverHandler
  ) {
    canvas.removeEventListener(
      "mousemove",
      ACSChartsState
        .demandHoverHandler
    );
  }

  if (
    ACSChartsState.demandLeaveHandler
  ) {
    canvas.removeEventListener(
      "mouseleave",
      ACSChartsState
        .demandLeaveHandler
    );
  }

  const hoverHandler =
    event => {
      const rect =
        canvas.getBoundingClientRect();

      const x =
        event.clientX -
        rect.left;

      const y =
        event.clientY -
        rect.top;

      if (
        x < plot.left ||
        x > plot.right ||
        y < plot.top ||
        y > plot.bottom
      ) {
        tooltip.style.display =
          "none";

        return;
      }

      const hourIndex =
        clamp(
          Math.floor(
            (
              x -
              plot.left
            ) /
            plot.width *
            24
          ),
          0,
          23
        );

      const liters =
        demandProfileData
          .hourlyDemandAt60CL[
            hourIndex
          ];

      const energy =
        demandProfileData
          .hourlyEnergyEquivalentKWh[
            hourIndex
          ];

      const hour =
        String(hourIndex)
          .padStart(2, "0");

      tooltip.innerHTML =
        `
          <strong>${hour}:00–${String(
            (hourIndex + 1) % 24
          ).padStart(2, "0")}:00</strong><br>
          ${formatNumber(liters, 2)} L<br>
          ${formatNumber(energy, 2)} kWh
        `;

      tooltip.style.display =
        "block";

      const tooltipWidth =
        tooltip.offsetWidth;

      const left =
        clamp(
          x + 14,
          4,
          rect.width -
          tooltipWidth -
          4
        );

      const top =
        Math.max(
          4,
          y - 64
        );

      tooltip.style.left =
        `${left}px`;

      tooltip.style.top =
        `${top}px`;
    };

  const leaveHandler =
    () => {
      tooltip.style.display =
        "none";
    };

  canvas.addEventListener(
    "mousemove",
    hoverHandler
  );

  canvas.addEventListener(
    "mouseleave",
    leaveHandler
  );

  ACSChartsState
    .demandHoverHandler =
    hoverHandler;

  ACSChartsState
    .demandLeaveHandler =
    leaveHandler;
}


/* ============================================================
 * GRÁFICA DEL PERFIL HORARIO DE DEMANDA
 * ============================================================ */

function normalizeDemandProfileData(
  input
) {
  const source =
    input &&
    typeof input === "object"
      ? input
      : {};

  const hourlyDemandAt60CL =
    Array.isArray(
      source.hourlyDemandAt60CL
    )
      ? source
          .hourlyDemandAt60CL
          .slice(0, 24)
          .map(
            value =>
              Number(value)
          )
      : [];

  if (
    hourlyDemandAt60CL.length !== 24 ||
    hourlyDemandAt60CL.some(
      value =>
        !Number.isFinite(value) ||
        value < 0
    )
  ) {
    throw new ACSChartsError(
      "El perfil horario de demanda debe contener 24 valores válidos en litros."
    );
  }

  const referenceTemperatureC =
    Number.isFinite(
      Number(
        source.referenceTemperatureC
      )
    )
      ? Number(
          source.referenceTemperatureC
        )
      : 60;

  const networkTemperatureC =
    Number.isFinite(
      Number(
        source.networkTemperatureC
      )
    )
      ? Number(
          source.networkTemperatureC
        )
      : 10;

  const hourlyEnergyEquivalentKWh =
    hourlyDemandAt60CL.map(
      volumeL =>
        calculateEquivalentEnergyKWh(
          volumeL,
          referenceTemperatureC,
          networkTemperatureC
        )
    );

  return {
    hours:
      Array.isArray(
        source.hours
      ) &&
      source.hours.length === 24
        ? source.hours
        : createDefaultHours(),

    hourlyDemandAt60CL,

    hourlyEnergyEquivalentKWh,

    referenceTemperatureC,

    networkTemperatureC
  };
}


function drawDemandProfileChart(
  context,
  plot,
  demandProfileData
) {
  const maximumLiters =
    getNiceMaximum(
      getMaximumFromSeries(
        [
          demandProfileData
            .hourlyDemandAt60CL
        ],
        1
      )
    );

  const maximumEnergy =
    calculateEquivalentEnergyKWh(
      maximumLiters,
      demandProfileData
        .referenceTemperatureC,
      demandProfileData
        .networkTemperatureC
    ) || 1;

  drawVerticalAxis(
    context,
    plot,
    {
      minimum: 0,
      maximum:
        maximumLiters,
      label:
        "Demanda (L)",
      side:
        "left"
    }
  );

  drawVerticalAxis(
    context,
    plot,
    {
      minimum: 0,
      maximum:
        maximumEnergy,
      label:
        "Energía equivalente (kWh)",
      side:
        "right"
    }
  );

  drawHorizontalAxis(
    context,
    plot,
    demandProfileData.hours
  );

  drawBarSeries(
    context,
    demandProfileData
      .hourlyDemandAt60CL,
    {
      plot,
      minimum: 0,
      maximum:
        maximumLiters,
      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .demand,
      widthFactor: 0.72
    }
  );

  renderLegend(
    [
      {
        label:
          "Demanda horaria a 60 °C",
        color:
          ACS_CHARTS_CONFIG
            .COLORS
            .demand
      }
    ],
    "demand"
  );
}


function renderDemandProfile(
  input
) {
  const demandProfileData =
    normalizeDemandProfileData(
      input
    );

  ACSChartsState
    .demandProfileData =
    demandProfileData;

  const {
    canvas,
    context,
    width,
    height
  } =
    prepareCanvas(
      "demand"
    );

  clearCanvas(
    context,
    width,
    height
  );

  const plot =
    getPlotArea(
      width,
      height
    );

  drawDemandProfileChart(
    context,
    plot,
    demandProfileData
  );

  attachDemandTooltip(
    canvas,
    plot,
    demandProfileData
  );

  return demandProfileData;
}


/* ============================================================
 * GRÁFICA DE CARGA
 * ============================================================ */

function drawLoadChart(
  context,
  plot,
  chartData
) {
  const data =
    chartData.load;

  const loadSeriesByTank =
    hasUsableSeriesCollection(
      data.continuousLoadByTank
    )
      ? data.continuousLoadByTank
      : (
          data.finalLoadByTank ||
          {}
        );

  const tankIds =
    Object.keys(
      loadSeriesByTank
    );

  drawVerticalAxis(
    context,
    plot,
    {
      minimum: 0,
      maximum: 100,
      label:
        "Carga (%)",
      side:
        "left",
      formatter:
        value =>
          `${formatNumber(
            value,
            0
          )} %`
    }
  );

  drawHorizontalAxis(
    context,
    plot,
    chartData.hours
  );

  tankIds.forEach(
    (
      tankId,
      index
    ) => {
      drawLineSeries(
        context,
        loadSeriesByTank[
          tankId
        ],
        {
          plot,
          minimum: 0,
          maximum: 100,
          color:
            index === 0
              ? ACS_CHARTS_CONFIG
                  .COLORS
                  .tank1
              : ACS_CHARTS_CONFIG
                  .COLORS
                  .tank2,
          drawPoints: false
        }
      );
    }
  );

  drawReferenceLine(
    context,
    data.tightReferencePercent,
    {
      plot,
      minimum: 0,
      maximum: 100,
      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .comfortTightReference,
      label:
        "Cubre justo · 30 %"
    }
  );

  drawReferenceLine(
    context,
    data.comfortableReferencePercent,
    {
      plot,
      minimum: 0,
      maximum: 100,
      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .comfortComfortableReference,
      label:
        "Cumple holgado · 60 %"
    }
  );

  const legendItems =
    tankIds.map(
      (
        tankId,
        index
      ) => ({
        label:
          `Carga continua ${tankId}`,
        color:
          index === 0
            ? ACS_CHARTS_CONFIG
                .COLORS
                .tank1
            : ACS_CHARTS_CONFIG
                .COLORS
                .tank2
      })
    );

  legendItems.push(
    {
      label:
        "Referencia 30 %",
      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .comfortTightReference
    },
    {
      label:
        "Referencia 60 %",
      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .comfortComfortableReference
    }
  );

  renderLegend(
    legendItems,
    "load"
  );
}


/* ============================================================
 * GRÁFICA DE ENERGÍA HORARIA
 * ============================================================ */

function drawHourlyEnergyChart(
  context,
  plot,
  chartData
) {
  const data =
    chartData.energy;

  const deliveredEnergyByTank =
    data.deliveredEnergyByTank ||
    {};

  const tankIds =
    Object.keys(
      deliveredEnergyByTank
    );

  const energySeries =
    tankIds.map(
      tankId =>
        deliveredEnergyByTank[
          tankId
        ]
    );

  const stackedTotals =
    Array.from(
      { length: 24 },
      (
        _value,
        hourIndex
      ) =>
        energySeries.reduce(
          (
            sum,
            series
          ) =>
            sum +
            finiteOrFallbackForChart(
              series[hourIndex],
              0
            ),
          0
        )
    );

  const maximumEnergy =
    getNiceMaximum(
      getMaximumFromSeries(
        [
          stackedTotals,
          data.totalDeliveredEnergyKWh
        ],
        1
      )
    );

  drawVerticalAxis(
    context,
    plot,
    {
      minimum: 0,
      maximum:
        maximumEnergy,
      label:
        "Energía entregada (kWh)",
      side:
        "left"
    }
  );

  drawHorizontalAxis(
    context,
    plot,
    chartData.hours
  );

  drawStackedBarSeries(
    context,
    energySeries,
    {
      plot,
      maximum:
        maximumEnergy,
      colors:
        tankIds.map(
          (
            _tankId,
            index
          ) =>
            index === 0
              ? ACS_CHARTS_CONFIG
                  .COLORS
                  .tank1Energy
              : ACS_CHARTS_CONFIG
                  .COLORS
                  .tank2Energy
        )
    }
  );

  renderLegend(
    tankIds.map(
      (
        tankId,
        index
      ) => ({
        label:
          `Energía entregada ${tankId}`,
        color:
          index === 0
            ? ACS_CHARTS_CONFIG
                .COLORS
                .tank1Energy
            : ACS_CHARTS_CONFIG
                .COLORS
                .tank2Energy
      })
    ),
    "hourlyEnergy"
  );
}


/* ============================================================
 * CRONOGRAMA DE FUNCIONAMIENTO Y POTENCIA
 * ============================================================ */

/**
 * Convierte una serie de potencia minuto a minuto en intervalos
 * continuos de funcionamiento.
 */
function buildRunningIntervals(
  values,
  threshold = 0.001
) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return [];
  }

  const intervals = [];
  let startIndex = null;

  values.forEach(
    (
      value,
      index
    ) => {
      const isRunning =
        isFiniteNumber(value) &&
        value > threshold;

      if (
        isRunning &&
        startIndex === null
      ) {
        startIndex = index;
      }

      const isLastPoint =
        index === values.length - 1;

      if (
        startIndex !== null &&
        (
          !isRunning ||
          isLastPoint
        )
      ) {
        const endIndex =
          isRunning &&
          isLastPoint
            ? index + 1
            : index;

        intervals.push({
          startIndex,
          endIndex
        });

        startIndex = null;
      }
    }
  );

  return intervals;
}


/**
 * Dibuja el eje temporal específico del cronograma.
 */
function drawLaneTimeAxis(
  context,
  plot
) {
  context.save();

  context.strokeStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .axis;

  context.fillStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .axis;

  context.lineWidth = 1;
  context.font =
    "11px system-ui, sans-serif";

  context.textAlign =
    "center";

  context.textBaseline =
    "top";

  context.beginPath();

  context.moveTo(
    plot.left,
    plot.bottom
  );

  context.lineTo(
    plot.right,
    plot.bottom
  );

  context.stroke();

  for (
    let hour = 0;
    hour <= 24;
    hour += 2
  ) {
    const x =
      plot.left +
      plot.width *
      hour / 24;

    context.strokeStyle =
      ACS_CHARTS_CONFIG
        .COLORS
        .grid;

    context.beginPath();

    context.moveTo(
      x,
      plot.top
    );

    context.lineTo(
      x,
      plot.bottom
    );

    context.stroke();

    context.fillStyle =
      ACS_CHARTS_CONFIG
        .COLORS
        .axis;

    context.fillText(
      `${String(hour).padStart(2, "0")}:00`,
      x,
      plot.bottom + 12
    );
  }

  context.fillStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .text;

  context.font =
    "600 12px system-ui, sans-serif";

  context.fillText(
    "Tiempo (h)",
    (
      plot.left +
      plot.right
    ) / 2,
    plot.bottom + 38
  );

  context.restore();
}


/**
 * Dibuja un carril operativo sin solaparse con los demás.
 */
function drawPowerLane(
  context,
  lane,
  lanePlot,
  seriesLength
) {
  const laneHeight =
    lanePlot.bottom -
    lanePlot.top;

  const maximum =
    getNiceMaximum(
      Math.max(
        lane.maximumPowerKW,
        getMaximumFromSeries(
          [lane.values],
          0
        ),
        1
      ) * 1.05
    );

  context.save();

  context.fillStyle =
    lane.background;

  context.fillRect(
    lanePlot.left,
    lanePlot.top,
    lanePlot.width,
    laneHeight
  );

  context.strokeStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .grid;

  context.lineWidth = 1;

  context.strokeRect(
    lanePlot.left,
    lanePlot.top,
    lanePlot.width,
    laneHeight
  );

  const horizontalDivisions = 2;

  for (
    let division = 0;
    division <= horizontalDivisions;
    division += 1
  ) {
    const ratio =
      division /
      horizontalDivisions;

    const y =
      lanePlot.bottom -
      lanePlot.height *
      ratio;

    const value =
      maximum * ratio;

    context.strokeStyle =
      ACS_CHARTS_CONFIG
        .COLORS
        .grid;

    context.setLineDash([4, 5]);
    context.beginPath();
    context.moveTo(
      lanePlot.left,
      y
    );
    context.lineTo(
      lanePlot.right,
      y
    );
    context.stroke();
    context.setLineDash([]);

    context.fillStyle =
      ACS_CHARTS_CONFIG
        .COLORS
        .axis;

    context.font =
      "10px system-ui, sans-serif";

    context.textAlign =
      "right";

    context.textBaseline =
      "middle";

    context.fillText(
      formatNumber(
        value,
        value < 10 ? 1 : 0
      ),
      lanePlot.left - 10,
      y
    );
  }

  context.fillStyle =
    lane.color;

  context.font =
    "700 12px system-ui, sans-serif";

  context.textAlign =
    "right";

  context.textBaseline =
    "middle";

  context.fillText(
    lane.label,
    lanePlot.left - 42,
    lanePlot.top + 18
  );

  context.fillStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .axis;

  context.font =
    "10px system-ui, sans-serif";

  context.fillText(
    "Potencia (kW)",
    lanePlot.left - 42,
    lanePlot.top + 34
  );

  context.strokeStyle =
    lane.color;

  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();

  let started = false;

  lane.values.forEach(
    (
      rawValue,
      index
    ) => {
      if (!isFiniteNumber(rawValue)) {
        started = false;
        return;
      }

      const value =
        clamp(
          rawValue,
          0,
          maximum
        );

      const x =
        lanePlot.left +
        lanePlot.width *
        index /
        Math.max(
          1,
          seriesLength - 1
        );

      const y =
        valueToY(
          value,
          0,
          maximum,
          lanePlot
        );

      if (!started) {
        context.moveTo(
          x,
          y
        );
        started = true;
      } else {
        context.lineTo(
          x,
          y
        );
      }
    }
  );

  context.stroke();
  context.restore();
}


function getOrCreatePowerTooltip(
  canvas
) {
  const container =
    canvas.closest(
      ".chart-container"
    );

  if (!container) {
    return null;
  }

  if (
    window.getComputedStyle(container)
      .position === "static"
  ) {
    container.style.position =
      "relative";
  }

  let tooltip =
    container.querySelector(
      ".acs-power-chart-tooltip"
    );

  if (!tooltip) {
    tooltip =
      document.createElement("div");

    tooltip.className =
      "acs-power-chart-tooltip";

    Object.assign(
      tooltip.style,
      {
        position: "absolute",
        display: "none",
        pointerEvents: "none",
        zIndex: "5",
        padding: "0.65rem 0.8rem",
        borderRadius: "0.6rem",
        background: "#ffffff",
        color:
          ACS_CHARTS_CONFIG
            .COLORS
            .text,
        border: "1px solid #e2e8f0",
        font:
          "12px system-ui, sans-serif",
        lineHeight: "1.55",
        boxShadow:
          "0 10px 28px rgba(15, 23, 42, 0.18)",
        whiteSpace: "nowrap"
      }
    );

    container.appendChild(
      tooltip
    );
  }

  return tooltip;
}


function attachPowerTooltip(
  canvas,
  plot,
  lanes,
  seriesLength
) {
  const tooltip =
    getOrCreatePowerTooltip(
      canvas
    );

  if (!tooltip) {
    return;
  }

  if (
    ACSChartsState.powerHoverHandler
  ) {
    canvas.removeEventListener(
      "mousemove",
      ACSChartsState
        .powerHoverHandler
    );
  }

  if (
    ACSChartsState.powerLeaveHandler
  ) {
    canvas.removeEventListener(
      "mouseleave",
      ACSChartsState
        .powerLeaveHandler
    );
  }

  const hoverHandler =
    event => {
      const rect =
        canvas.getBoundingClientRect();

      const scaleX =
        canvas.width /
        Math.max(
          1,
          rect.width
        );

      const scaleY =
        canvas.height /
        Math.max(
          1,
          rect.height
        );

      const x =
        (
          event.clientX -
          rect.left
        ) * scaleX;

      const y =
        (
          event.clientY -
          rect.top
        ) * scaleY;

      if (
        x < plot.left ||
        x > plot.right ||
        y < plot.top ||
        y > plot.bottom
      ) {
        tooltip.style.display =
          "none";
        return;
      }

      const index =
        clamp(
          Math.round(
            (
              x -
              plot.left
            ) /
            Math.max(
              1,
              plot.width
            ) *
            Math.max(
              0,
              seriesLength - 1
            )
          ),
          0,
          Math.max(
            0,
            seriesLength - 1
          )
        );

      const minute =
        Math.round(
          index /
          Math.max(
            1,
            seriesLength - 1
          ) * 1440
        );

      const hour =
        Math.floor(
          minute / 60
        ) % 24;

      const minuteOfHour =
        minute % 60;

      const rows =
        lanes.map(
          lane => {
            const value =
              finiteOrFallbackForChart(
                lane.values[index],
                0
              );

            return `
              <div style="display:flex;align-items:center;gap:0.45rem;">
                <span style="width:0.55rem;height:0.55rem;border-radius:999px;background:${escapeHtml(
                  lane.color
                )};display:inline-block;"></span>
                <span>${escapeHtml(
                  lane.label
                )}: <strong>${formatNumber(
                  value,
                  2
                )} kW</strong></span>
              </div>
            `;
          }
        )
        .join("");

      tooltip.innerHTML = `
        <div style="font-weight:700;margin-bottom:0.25rem;">
          ${String(hour).padStart(2, "0")}:${String(
            minuteOfHour
          ).padStart(2, "0")}
        </div>
        ${rows}
      `;

      tooltip.style.display =
        "block";

      const displayX =
        event.clientX -
        rect.left;

      const displayY =
        event.clientY -
        rect.top;

      const tooltipWidth =
        tooltip.offsetWidth;

      tooltip.style.left =
        `${clamp(
          displayX + 14,
          4,
          rect.width -
          tooltipWidth -
          4
        )}px`;

      tooltip.style.top =
        `${Math.max(
          4,
          displayY - 74
        )}px`;
    };

  const leaveHandler =
    () => {
      tooltip.style.display =
        "none";
    };

  canvas.addEventListener(
    "mousemove",
    hoverHandler
  );

  canvas.addEventListener(
    "mouseleave",
    leaveHandler
  );

  ACSChartsState
    .powerHoverHandler =
    hoverHandler;

  ACSChartsState
    .powerLeaveHandler =
    leaveHandler;
}


function drawPowerChart(
  context,
  plot,
  chartData
) {
  const data =
    chartData.energy;

  const exchangerPowerByTankKW =
    data.exchangerPowerByTankKW ||
    {};

  const maximumPowerByTank =
    data
      .exchangerMaximumPowerByTankKW ||
    {};

  const tankIds =
    Object.keys(
      exchangerPowerByTankKW
    );

  const generatorSeries =
    Array.isArray(
      data.generatorPowerKW
    )
      ? data.generatorPowerKW
      : [];

  const allSeriesLengths = [
    generatorSeries.length,
    ...tankIds.map(
      tankId =>
        Array.isArray(
          exchangerPowerByTankKW[
            tankId
          ]
        )
          ? exchangerPowerByTankKW[
              tankId
            ].length
          : 0
    )
  ].filter(
    length =>
      length > 0
  );

  const seriesLength =
    allSeriesLengths.length > 0
      ? Math.max(
          ...allSeriesLengths
        )
      : 1440;

  const lanes = [
    {
      label: "Generador",
      values:
        generatorSeries,
      maximumPowerKW:
        finiteOrFallbackForChart(
          data.generatorMaximumPowerKW,
          getMaximumFromSeries(
            [generatorSeries],
            0
          )
        ),
      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .generatorPower,
      background:
        "rgba(220, 38, 38, 0.025)"
    },
    ...tankIds.map(
      (
        tankId,
        index
      ) => ({
        label:
          `D${index + 1}`,
        values:
          Array.isArray(
            exchangerPowerByTankKW[
              tankId
            ]
          )
            ? exchangerPowerByTankKW[
                tankId
              ]
            : [],
        maximumPowerKW:
          finiteOrFallbackForChart(
            maximumPowerByTank[
              tankId
            ],
            getMaximumFromSeries(
              [
                exchangerPowerByTankKW[
                  tankId
                ] || []
              ],
              0
            )
          ),
        color:
          index === 0
            ? ACS_CHARTS_CONFIG
                .COLORS
                .exchanger1Power
            : ACS_CHARTS_CONFIG
                .COLORS
                .exchanger2Power,
        background:
          index === 0
            ? "rgba(29, 78, 216, 0.025)"
            : "rgba(21, 128, 61, 0.025)"
      })
    )
  ];

  const laneContainer = {
    left:
      plot.left + 120,
    right:
      plot.right,
    top:
      plot.top,
    bottom:
      plot.bottom,
    width:
      plot.width - 120,
    height:
      plot.height
  };

  const gap = 14;
  const laneHeight =
    (
      laneContainer.height -
      gap *
      Math.max(
        0,
        lanes.length - 1
      )
    ) /
    Math.max(
      1,
      lanes.length
    );

  lanes.forEach(
    (
      lane,
      index
    ) => {
      const top =
        laneContainer.top +
        index *
        (
          laneHeight +
          gap
        );

      const lanePlot = {
        left:
          laneContainer.left,
        right:
          laneContainer.right,
        top,
        bottom:
          top + laneHeight,
        width:
          laneContainer.width,
        height:
          laneHeight
      };

      drawPowerLane(
        context,
        lane,
        lanePlot,
        seriesLength
      );
    }
  );

  drawLaneTimeAxis(
    context,
    laneContainer
  );

  renderLegend(
    lanes.map(
      lane => ({
        label:
          lane.label,
        color:
          lane.color
      })
    ),
    "power"
  );

  const canvas =
    context.canvas;

  attachPowerTooltip(
    canvas,
    laneContainer,
    lanes,
    seriesLength
  );
}


/**
 * Dibuja la potencia instantánea todo/nada del generador.
 * La altura es siempre la potencia nominal y la anchura de cada tramo
 * representa el tiempo equivalente real obtenido de E / P.
 */
function drawGeneratorInstantPowerChart(
  context,
  plot,
  chartData
) {
  const data =
    chartData.energy || {};

  const nominalPowerKW =
    finiteOrFallbackForChart(
      data.generatorMaximumPowerKW,
      0
    );

  const intervals =
    Array.isArray(
      data.generatorOperatingIntervals
    )
      ? data.generatorOperatingIntervals
          .filter(
            interval =>
              isFiniteNumber(
                interval?.startMinute
              ) &&
              isFiniteNumber(
                interval?.endMinute
              ) &&
              interval.endMinute >
                interval.startMinute
          )
      : [];

  const maximumPowerKW =
    getNiceMaximum(
      Math.max(
        nominalPowerKW,
        1
      ) * 1.05
    );

  drawVerticalAxis(
    context,
    plot,
    {
      minimum: 0,
      maximum:
        maximumPowerKW,
      label:
        "Potencia instantánea (kW)",
      side:
        "left"
    }
  );

  drawLaneTimeAxis(
    context,
    plot
  );

  const yPower =
    valueToY(
      nominalPowerKW,
      0,
      maximumPowerKW,
      plot
    );

  context.save();

  context.strokeStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .generatorPower;

  context.lineWidth = 2;
  context.lineJoin = "miter";
  context.lineCap = "butt";

  if (
    intervals.length > 0 &&
    nominalPowerKW > 0
  ) {
    intervals.forEach(
      interval => {
        const startMinute =
          clamp(
            interval.startMinute,
            0,
            1440
          );

        const endMinute =
          clamp(
            interval.endMinute,
            0,
            1440
          );

        const xStart =
          plot.left +
          plot.width *
          startMinute /
          1440;

        const xEnd =
          plot.left +
          plot.width *
          endMinute /
          1440;

        context.beginPath();
        context.moveTo(
          xStart,
          plot.bottom
        );
        context.lineTo(
          xStart,
          yPower
        );
        context.lineTo(
          xEnd,
          yPower
        );
        context.lineTo(
          xEnd,
          plot.bottom
        );
        context.stroke();
      }
    );
  } else {
    /*
     * Compatibilidad defensiva con resultados antiguos. Sólo se utiliza
     * cuando app.js no ha entregado la cronología de ciclos.
     */
    const fallbackPowerSeries =
      Array.isArray(
        data.generatorPowerKW
      )
        ? data.generatorPowerKW
        : [];

    const fallbackIntervals =
      buildRunningIntervals(
        fallbackPowerSeries
      );

    const pointCount =
      Math.max(
        1,
        fallbackPowerSeries.length
      );

    fallbackIntervals.forEach(
      interval => {
        const xStart =
          plot.left +
          plot.width *
          interval.startIndex /
          pointCount;

        const xEnd =
          plot.left +
          plot.width *
          interval.endIndex /
          pointCount;

        context.beginPath();
        context.moveTo(
          xStart,
          plot.bottom
        );
        context.lineTo(
          xStart,
          yPower
        );
        context.lineTo(
          xEnd,
          yPower
        );
        context.lineTo(
          xEnd,
          plot.bottom
        );
        context.stroke();
      }
    );
  }

  context.restore();

  drawReferenceLine(
    context,
    nominalPowerKW,
    {
      plot,
      minimum: 0,
      maximum:
        maximumPowerKW,
      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .generatorMaximum,
      label:
        `Potencia fija · ${formatNumber(
          nominalPowerKW,
          1
        )} kW`
    }
  );

  renderLegend(
    [
      {
        label:
          `Generador todo/nada · ${formatNumber(
            nominalPowerKW,
            1
          )} kW`,
        color:
          ACS_CHARTS_CONFIG
            .COLORS
            .generatorPower
      }
    ],
    "power"
  );
}


/* ============================================================
 * MENSAJE SIN DATOS
 * ============================================================ */

function drawEmptyChart(
  context,
  width,
  height,
  message,
  view
) {
  clearCanvas(
    context,
    width,
    height
  );

  context.fillStyle =
    ACS_CHARTS_CONFIG
      .COLORS
      .axis;

  context.font =
    "600 14px system-ui, sans-serif";

  context.textAlign =
    "center";

  context.textBaseline =
    "middle";

  context.fillText(
    message ||
    "No hay datos disponibles.",
    width / 2,
    height / 2
  );

  renderLegend(
    [],
    view
  );
}


/* ============================================================
 * VALIDACIÓN DE DATOS
 * ============================================================ */

function validateChartData(
  chartData
) {
  if (
    !chartData ||
    typeof chartData !== "object"
  ) {
    throw new ACSChartsError(
      "Los datos de las gráficas son obligatorios."
    );
  }

  if (
    !Array.isArray(
      chartData.hours
    ) ||
    chartData.hours.length !== 24
  ) {
    throw new ACSChartsError(
      "Las gráficas necesitan 24 horas de resultados.",
      {
        receivedHours:
          chartData.hours
            ?.length ?? null
      }
    );
  }

  if (
    !chartData.energy ||
    typeof chartData.energy !==
      "object"
  ) {
    throw new ACSChartsError(
      "No se han recibido los datos de energía y potencia."
    );
  }

  if (
    !chartData.load ||
    typeof chartData.load !==
      "object"
  ) {
    throw new ACSChartsError(
      "No se han recibido los datos de carga."
    );
  }

  return true;
}


/* ============================================================
 * RENDERIZADO PRINCIPAL
 * ============================================================ */

function render(
  view,
  chartData
) {
  const normalizedChartData =
    normalizeResultsChartData(
      chartData
    );

  validateChartData(
    normalizedChartData
  );

  const allowedViews = [
    "load",
    "hourlyEnergy",
    "power"
  ];

  if (
    !allowedViews.includes(view)
  ) {
    throw new ACSChartsError(
      `Vista gráfica no válida: ${view}.`
    );
  }

  ACSChartsState.currentView =
    view;

  ACSChartsState.chartData =
    normalizedChartData;

  const {
    context,
    width,
    height
  } =
    prepareCanvas(view);

  clearCanvas(
    context,
    width,
    height
  );

  const plot =
    getPlotArea(
      width,
      height
    );

  if (view === "load") {
    drawLoadChart(
      context,
      plot,
      normalizedChartData
    );

    return;
  }

  if (
    view === "hourlyEnergy"
  ) {
    drawHourlyEnergyChart(
      context,
      plot,
      normalizedChartData
    );

    return;
  }

  drawPowerChart(
    context,
    plot,
    normalizedChartData
  );
}


function renderAll(
  chartData
) {
  const normalizedChartData =
    normalizeResultsChartData(
      chartData
    );

  validateChartData(
    normalizedChartData
  );

  ACSChartsState.chartData =
    normalizedChartData;

  [
    "load",
    "hourlyEnergy",
    "power"
  ].forEach(
    view => {
      render(
        view,
        normalizedChartData
      );
    }
  );

  ACSChartsState.currentView =
    "load";
}


function redraw() {
  if (
    ACSChartsState
      .demandProfileData
  ) {
    try {
      renderDemandProfile(
        ACSChartsState
          .demandProfileData
      );
    } catch (error) {
      console.error(error);
    }
  }

  if (
    ACSChartsState.chartData
  ) {
    renderAll(
      ACSChartsState.chartData
    );
  }
}


function clearDemandProfile() {
  try {
    const {
      context,
      width,
      height
    } =
      prepareCanvas(
        "demand"
      );

    drawEmptyChart(
      context,
      width,
      height,
      "Completa los datos de demanda para mostrar el perfil horario.",
      "demand"
    );
  } catch (error) {
    console.error(error);
  }
}


function clearResults() {
  [
    "load",
    "hourlyEnergy",
    "power"
  ].forEach(
    view => {
      try {
        const {
          context,
          width,
          height
        } =
          prepareCanvas(view);

        drawEmptyChart(
          context,
          width,
          height,
          "Ejecuta la simulación para mostrar esta gráfica.",
          view
        );
      } catch (error) {
        console.error(error);
      }
    }
  );

  ACSChartsState.currentView =
    "load";
}


function clear() {
  clearDemandProfile();
  clearResults();
}


/* ============================================================
 * REDIMENSIONADO
 * ============================================================ */

function handleResize() {
  if (
    ACSChartsState.resizeFrame
  ) {
    window.cancelAnimationFrame(
      ACSChartsState.resizeFrame
    );
  }

  ACSChartsState.resizeFrame =
    window.requestAnimationFrame(
      () => {
        ACSChartsState.resizeFrame =
          null;

        redraw();
      }
    );
}


/* ============================================================
 * EXPORTACIÓN DE IMAGEN
 * ============================================================ */

function getCurrentChartImage(
  view = ACSChartsState.currentView
) {
  const canvas =
    ACSChartsState
      .canvases
      .get(view);

  if (!canvas) {
    return null;
  }

  return canvas.toDataURL(
    "image/png",
    1
  );
}


function getChartImage(
  view,
  chartData = null
) {
  if (view === "demand") {
    if (chartData) {
      renderDemandProfile(
        chartData
      );
    } else if (
      ACSChartsState
        .demandProfileData
    ) {
      renderDemandProfile(
        ACSChartsState
          .demandProfileData
      );
    } else {
      return null;
    }

    return getCurrentChartImage(
      "demand"
    );
  }

  render(
    view,
    chartData
  );

  return getCurrentChartImage(
    view
  );
}


/* ============================================================
 * API PÚBLICA
 * ============================================================ */

const ACSCharts =
  Object.freeze({
    version:
      ACS_CHARTS_CONFIG.VERSION,

    render,

    renderAll,

    renderDemandProfile,

    redraw,

    clear,

    clearDemandProfile,

    clearResults,

    getCurrentChartImage,

    getChartImage,

    calculateEquivalentEnergyKWh
  });


/* ============================================================
 * INICIALIZACIÓN
 * ============================================================ */

function initializeCharts() {
  window.addEventListener(
    "resize",
    handleResize
  );

  clear();
}


/* ============================================================
 * EXPORTACIÓN EN NAVEGADOR
 * ============================================================ */

if (
  typeof window !==
  "undefined"
) {
  window.ACSCharts =
    ACSCharts;

  document.addEventListener(
    "DOMContentLoaded",
    initializeCharts
  );
}


/* ============================================================
 * EXPORTACIÓN NODE.JS
 * ============================================================ */

if (
  typeof module !==
    "undefined" &&
  module.exports
) {
  module.exports = {
    ACSCharts,

    ACSChartsError,

    ACS_CHARTS_CONFIG
  };
}