"use strict";

/**
 * ============================================================
 * PRO ACS
 * GRÁFICAS DE RESULTADOS
 * ============================================================
 *
 * Responsabilidades:
 *
 * - Dibujar las gráficas de las últimas 24 horas.
 * - Mostrar consumo y generación.
 * - Mostrar carga final de los depósitos.
 *
 * Este archivo no realiza cálculos físicos ni valoraciones.
 * Solo representa los datos preparados por block7-analysis.js.
 */


/* ============================================================
 * CONFIGURACIÓN
 * ============================================================ */

const ACS_CHARTS_CONFIG = Object.freeze({
  VERSION: "1.2.0",

  MINIMUM_WIDTH_PX: 960,

  HEIGHT_PX: 420,

  DEVICE_PIXEL_RATIO_LIMIT: 2,

  PADDING: Object.freeze({
    top: 34,
    right: 70,
    bottom: 58,
    left: 70
  }),

  COLORS: Object.freeze({
    demand: "#94a3b8",

    tank1: "#2563eb",

    tank2: "#7c3aed",

    totalPower: "#dc2626",

    sanitaryReference: "#b91c1c",

    storageReference: "#0f766e",

    comfortTightReference: "#d97706",

    comfortComfortableReference: "#15803d",

    axis: "#64748b",

    grid: "#e2e8f0",

    text: "#334155",

    background: "#ffffff"
  })
});


/* ============================================================
 * ESTADO
 * ============================================================ */

const ACSChartsState = {
  currentView: "energy",

  chartData: null,

  canvases: new Map(),

  contexts: new Map(),

  resizeFrame: null
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

    this.name =
      "ACSChartsError";

    this.details =
      details;
  }
}


/* ============================================================
 * UTILIDADES
 * ============================================================ */

/**
 * Comprueba si un valor es un número finito.
 */
function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}


/**
 * Limita un número a un intervalo.
 */
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


/**
 * Formatea números para los ejes y leyendas.
 */
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


/**
 * Obtiene los valores numéricos válidos.
 */
function getFiniteValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter(
    isFiniteNumber
  );
}


/**
 * Obtiene el máximo de varias series.
 */
function getMaximumFromSeries(
  seriesCollection,
  fallback = 1
) {
  const values =
    seriesCollection
      .flatMap(
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


/**
 * Obtiene el mínimo de varias series.
 */
function getMinimumFromSeries(
  seriesCollection,
  fallback = 0
) {
  const values =
    seriesCollection
      .flatMap(
        series =>
          getFiniteValues(series)
      );

  if (values.length === 0) {
    return fallback;
  }

  return Math.min(
    fallback,
    ...values
  );
}


/**
 * Redondea un máximo para obtener una escala legible.
 */
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

  return (
    niceNormalized *
    magnitude
  );
}


/**
 * Escapa texto para insertarlo en HTML.
 */
function escapeHtml(value) {
  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* ============================================================
 * CANVAS
 * ============================================================ */

/**
 * Obtiene y prepara el canvas.
 */
function getCanvasIdForView(view) {
  const ids = {
    energy: "resultsChartEnergy",
    load: "resultsChartLoad"
  };

  return ids[view] || "resultsChartEnergy";
}


function getLegendIdForView(view) {
  const ids = {
    energy: "chartLegendEnergy",
    load: "chartLegendLoad"
  };

  return ids[view] || "chartLegendEnergy";
}


/**
 * Obtiene y prepara el canvas de una vista concreta.
 */
function prepareCanvas(view = "energy") {
  const canvasId =
    getCanvasIdForView(view);

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

  const availableWidth =
    container
      ? container.clientWidth - 22
      : ACS_CHARTS_CONFIG
          .MINIMUM_WIDTH_PX;

  const cssWidth =
    Math.max(
      ACS_CHARTS_CONFIG
        .MINIMUM_WIDTH_PX,
      availableWidth
    );

  const cssHeight =
    ACS_CHARTS_CONFIG
      .HEIGHT_PX;

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

  ACSChartsState
    .canvases
    .set(
      view,
      canvas
    );

  ACSChartsState
    .contexts
    .set(
      view,
      context
    );

  return {
    canvas,
    context,

    width:
      cssWidth,

    height:
      cssHeight
  };
}


/**
 * Limpia el canvas.
 */
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

/**
 * Calcula las dimensiones internas.
 */
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


/**
 * Convierte un índice horario en una coordenada X.
 */
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


/**
 * Convierte un valor en coordenada Y.
 */
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

/**
 * Dibuja el eje horizontal y las horas.
 */
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
    "Hora",
    (
      plot.left +
      plot.right
    ) / 2,
    plot.bottom + 38
  );

  context.restore();
}


/**
 * Dibuja un eje vertical.
 */
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
      ? axisX + 48
      : axisX - 48,
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

/**
 * Dibuja una serie de barras.
 */
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
    groupIndex = 0,
    groupCount = 1
  } = options;

  const hourWidth =
    plot.width / 24;

  const totalBarWidth =
    hourWidth * 0.72;

  const individualBarWidth =
    totalBarWidth /
    groupCount;

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

      const groupStartX =
        centerX -
        totalBarWidth / 2;

      const x =
        groupStartX +
        individualBarWidth *
        groupIndex +
        individualBarWidth *
        0.08;

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

      const width =
        individualBarWidth *
        0.84;

      context.fillStyle =
        color;

      context.fillRect(
        x,
        y,
        width,
        height
      );
    }
  );
}


/**
 * Dibuja una línea.
 */
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
    drawPoints = true
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
        getHourCenterX(
          index,
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
          getHourCenterX(
            index,
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


/**
 * Dibuja una línea horizontal de referencia.
 */
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

  context.lineWidth = 1.5;

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

/**
 * Actualiza la leyenda HTML.
 */
function renderLegend(items, view = ACSChartsState.currentView) {
  const container =
    document.getElementById(
      getLegendIdForView(view)
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
 * GRÁFICA DE ENERGÍA
 * ============================================================ */

/**
 * Dibuja consumo, generación y potencia total.
 *
 * Eje izquierdo:
 * - Perfil de consumo en L/h a 60 °C.
 *
 * Eje derecho:
 * - Energía generada en kWh.
 * - Potencia media horaria en kW.
 */
function drawEnergyChart(
  context,
  plot,
  chartData
) {
  const data =
    chartData.energy;

  const tankIds =
    Object.keys(
      data.generatedEnergyByTank
    );

  const generatedSeries =
    tankIds.map(
      tankId =>
        data
          .generatedEnergyByTank[
            tankId
          ]
    );

  const maximumConsumption =
    getNiceMaximum(
      getMaximumFromSeries(
        [
          data
            .consumptionAt60CL
        ],
        1
      )
    );

  const maximumEnergy =
    getNiceMaximum(
      getMaximumFromSeries(
        [
          ...generatedSeries,

          data
            .averageTotalPowerKW
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
        maximumConsumption,

      label:
        "Consumo (L/h a 60 °C)",

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
        "Energía / potencia",

      side:
        "right"
    }
  );

  drawHorizontalAxis(
    context,
    plot,
    chartData.hours
  );

  drawBarSeries(
    context,

    data
      .consumptionAt60CL,

    {
      plot,

      minimum: 0,

      maximum:
        maximumConsumption,

      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .demand,

      groupIndex: 0,

      groupCount: 1
    }
  );

  generatedSeries.forEach(
    (
      series,
      index
    ) => {
      const hourWidth =
        plot.width / 24;

      const barWidth =
        hourWidth *
        0.2;

      series.forEach(
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

          const offset =
            (
              index -
              (
                generatedSeries.length -
                1
              ) /
              2
            ) *
            barWidth;

          const x =
            centerX +
            offset -
            barWidth / 2;

          const y =
            valueToY(
              value,
              0,
              maximumEnergy,
              plot
            );

          context.fillStyle =
            index === 0
              ? ACS_CHARTS_CONFIG
                  .COLORS
                  .tank1
              : ACS_CHARTS_CONFIG
                  .COLORS
                  .tank2;

          context.fillRect(
            x,
            y,
            barWidth * 0.82,
            plot.bottom - y
          );
        }
      );
    }
  );

  drawLineSeries(
    context,

    data
      .averageTotalPowerKW,

    {
      plot,

      minimum: 0,

      maximum:
        maximumEnergy,

      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .totalPower,

      lineWidth: 2.3
    }
  );

  const legendItems = [
    {
      label:
        "Perfil de consumo",

      color:
        ACS_CHARTS_CONFIG
          .COLORS
          .demand
    }
  ];

  tankIds.forEach(
    (
      tankId,
      index
    ) => {
      legendItems.push({
        label:
          `Energía generada ${tankId}`,

        color:
          index === 0
            ? ACS_CHARTS_CONFIG
                .COLORS
                .tank1
            : ACS_CHARTS_CONFIG
                .COLORS
                .tank2
      });
    }
  );

  legendItems.push({
    label:
      "Potencia total media",

    color:
      ACS_CHARTS_CONFIG
        .COLORS
        .totalPower
  });

  renderLegend(
    legendItems
  );
}


/* ============================================================
 * GRÁFICA DE CARGA
 * ============================================================ */

/**
 * Dibuja la carga final horaria de cada depósito.
 */
function drawLoadChart(
  context,
  plot,
  chartData
) {
  const data =
    chartData.load;

  const tankIds =
    Object.keys(
      data.finalLoadByTank
    );

  drawVerticalAxis(
    context,
    plot,
    {
      minimum: 0,
      maximum: 100,

      label:
        "Carga final (%)",

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

        data
          .finalLoadByTank[
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
                  .tank2
        }
      );
    }
  );

  drawReferenceLine(
    context,

    data
      .tightReferencePercent,

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

    data
      .comfortableReferencePercent,

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
          `Carga final ${tankId}`,

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
    legendItems
  );
}


/* ============================================================
 * MENSAJE SIN DATOS
 * ============================================================ */

/**
 * Dibuja un mensaje cuando no hay datos.
 */
function drawEmptyChart(
  context,
  width,
  height,
  message =
    "No hay datos disponibles."
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
    message,
    width / 2,
    height / 2
  );

  renderLegend([]);
}


/* ============================================================
 * RENDERIZADO PRINCIPAL
 * ============================================================ */

/**
 * Comprueba la estructura de los datos.
 */
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
      "La gráfica necesita 24 horas de resultados.",
      {
        receivedHours:
          chartData.hours
            ?.length ?? null
      }
    );
  }

  return true;
}


/**
 * Dibuja una de las dos gráficas disponibles.
 */
function render(
  view,
  chartData
) {
  validateChartData(
    chartData
  );

  const allowedViews = [
    "energy",
    "load"
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
    chartData;

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

  if (view === "energy") {
    drawEnergyChart(
      context,
      plot,
      chartData
    );

    return;
  }

  drawLoadChart(
    context,
    plot,
    chartData
  );
}


/**
 * Dibuja simultáneamente las dos gráficas disponibles.
 */
function renderAll(chartData) {
  validateChartData(
    chartData
  );

  ACSChartsState.chartData =
    chartData;

  [
    "energy",
    "load"
  ].forEach(
    view => {
      render(
        view,
        chartData
      );
    }
  );

  ACSChartsState.currentView =
    "energy";
}


/**
 * Redibuja la gráfica actual.
 */
function redraw() {
  if (
    !ACSChartsState.chartData
  ) {
    return;
  }

  renderAll(
    ACSChartsState.chartData
  );
}


/**
 * Limpia la gráfica.
 */
function clear() {
  const views = [
    "energy",
    "load"
  ];

  views.forEach(
    view => {
      try {
        const {
          context,
          width,
          height
        } =
          prepareCanvas(view);

        ACSChartsState.currentView =
          view;

        drawEmptyChart(
          context,
          width,
          height,
          "Ejecuta la simulación para mostrar esta gráfica."
        );
      } catch (error) {
        console.error(error);
      }
    }
  );

  ACSChartsState.currentView =
    "energy";
}


/* ============================================================
 * REDIMENSIONADO
 * ============================================================ */

/**
 * Redibuja evitando llamadas excesivas durante el resize.
 */
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

/**
 * Devuelve la gráfica actual como imagen PNG.
 *
 * Será utilizada posteriormente por report.js.
 */
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


/**
 * Dibuja temporalmente una vista y devuelve su imagen.
 *
 * Permite incluir las gráficas disponibles en el informe.
 */
function getChartImage(
  view,
  chartData
) {
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

    redraw,

    clear,

    getCurrentChartImage,

    getChartImage
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