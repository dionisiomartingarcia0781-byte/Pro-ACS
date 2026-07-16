"use strict";

/**
 * ============================================================
 * PRO ACS · GENERADOR DE INFORME PDF
 * Versión 3.5.0
 * ============================================================
 *
 * Informe profesional de 10 páginas.
 *
 * PRINCIPIO DE MAQUETACIÓN:
 * Todo texto multilínea se dibuja línea a línea con un interlineado
 * fijo expresado en milímetros. No se utiliza lineHeightFactor de
 * jsPDF para bloques multilínea, evitando solapes entre líneas.
 *
 * Páginas:
 * 1. Portada
 * 2. Resumen ejecutivo
 * 3. Datos de entrada
 * 4. Metodología
 * 5. Balance energético
 * 6. Evolución temporal: perfil de demanda y carga
 * 7. Evolución temporal: energía y potencia
 * 8. Tabla horaria de operación
 * 9. Diagnóstico
 * 10. Conclusiones y responsabilidad
 */


/* ============================================================
 * CONFIGURACIÓN
 * ============================================================ */

const ACS_REPORT_CONFIG = Object.freeze({
  VERSION: "3.5.0",
  SOFTWARE_VERSION: "Pro ACS 1.2",
  PAGE_COUNT: 10,

  PAGE: Object.freeze({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  }),

  MARGIN: Object.freeze({
    left: 16,
    right: 16,
    top: 18,
    bottom: 16
  }),

  COLORS: Object.freeze({
    navy: [12, 38, 75],
    blue: [37, 99, 235],
    blueSoft: [235, 243, 255],
    green: [22, 135, 72],
    greenSoft: [232, 247, 238],
    amber: [194, 91, 8],
    amberSoft: [255, 247, 226],
    red: [185, 28, 28],
    redSoft: [254, 236, 236],
    text: [22, 35, 55],
    textSoft: [62, 78, 103],
    muted: [96, 113, 138],
    line: [211, 222, 236],
    surface: [248, 250, 253],
    white: [255, 255, 255]
  })
});


/* ============================================================
 * ESTADO INTERNO
 * ============================================================ */

const ReportState = {
  doc: null,
  pageWidth: 0,
  pageHeight: 0,
  contentWidth: 0,
  pageNumber: 1,
  projectName: "Proyecto"
};


class ACSReportError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "ACSReportError";
    this.details = details;
  }
}


/* ============================================================
 * UTILIDADES
 * ============================================================ */

function getJsPdfConstructor() {
  const JsPdf = window.jspdf?.jsPDF;

  if (typeof JsPdf !== "function") {
    throw new ACSReportError(
      "No se ha cargado jsPDF. Comprueba que la librería se incluya antes de report.js."
    );
  }

  return JsPdf;
}


function validateInput(input) {
  if (!input || typeof input !== "object") {
    throw new ACSReportError("No se han recibido datos para el informe.");
  }

  if (!input.analysis || typeof input.analysis !== "object") {
    throw new ACSReportError(
      "No existe una simulación válida. Ejecuta primero el cálculo."
    );
  }

  if (!input.analysis.report || typeof input.analysis.report !== "object") {
    throw new ACSReportError(
      "El análisis no contiene el bloque necesario para generar el informe."
    );
  }
}


function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}


function safeArray(value) {
  return Array.isArray(value) ? value : [];
}


function firstDefined(...values) {
  return values.find(
    value => value !== undefined && value !== null && value !== ""
  );
}


function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}


function formatNumber(value, digits = 2) {
  const numeric = numberOrNull(value);

  if (numeric === null) {
    return "—";
  }

  return numeric.toLocaleString("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}


function formatEnergy(value, digits = 2) {
  return `${formatNumber(value, digits)} kWh`;
}


function formatPercent(value, digits = 1) {
  return `${formatNumber(value, digits)} %`;
}


function formatTemperature(value, digits = 1) {
  return `${formatNumber(value, digits)} °C`;
}


function formatFlow(value, digits = 2) {
  return `${formatNumber(value, digits)} L/min`;
}


function formatDurationMinutes(value) {
  const minutes = numberOrNull(value);

  if (minutes === null) {
    return "—";
  }

  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;

  if (hours === 0) {
    return `${remainder} min`;
  }

  if (remainder === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${remainder} min`;
}


function formatDate(value) {
  if (!value) {
    return "—";
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? `${value}T00:00:00`
    : value;

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("es-ES");
}


function sanitizeFileName(value) {
  return String(value || "Proyecto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "") || "Proyecto";
}


function getProfileName(value) {
  const labels = {
    residential: "Viviendas",
    hotel: "Hotel",
    gym: "Gimnasio",
    custom: "Perfil a medida"
  };

  return labels[value] || String(value || "—");
}


function getLevelColor(level) {
  const colors = ACS_REPORT_CONFIG.COLORS;

  if (level === "success") return colors.green;
  if (level === "warning") return colors.amber;
  if (level === "danger") return colors.red;

  return colors.blue;
}


function getLevelBackground(level) {
  const colors = ACS_REPORT_CONFIG.COLORS;

  if (level === "success") return colors.greenSoft;
  if (level === "warning") return colors.amberSoft;
  if (level === "danger") return colors.redSoft;

  return colors.blueSoft;
}


/* ============================================================
 * NORMALIZACIÓN DE DATOS
 * ============================================================ */

function normalizeReportData(input) {
  const report = safeObject(input.analysis.report);
  const project = safeObject(
    firstDefined(report.project, input.analysis.project, input.project)
  );

  const inputSummary = safeObject(report.inputSummary);
  const demand = safeObject(inputSummary.demand);
  const temperatures = safeObject(inputSummary.temperatures);
  const generator = safeObject(inputSummary.generator);
  const recirculation = safeObject(inputSummary.recirculation);

  const results = safeObject(report.generalResults);
  const energy = safeObject(results.energy);
  const comfort = safeObject(results.comfort);
  const generatorResults = safeObject(results.generator);
  const hydraulics = safeObject(results.hydraulics);

  const engineAnalysis =
    input
      ?.simulation
      ?.simulation
      ?.results
      ?.analysis ||
    input
      ?.simulation
      ?.results
      ?.analysis ||
    input
      ?.analysis
      ?.engineResult
      ?.simulation
      ?.results
      ?.analysis ||
    {};

  const hourlyResults =
    safeArray(engineAnalysis.hourly);

  const minuteResults =
    safeArray(engineAnalysis.minute);

  const hourlyOperationRows =
    hourlyResults
      .slice(0, 24)
      .map(
        (
          hour,
          displayIndex
        ) => {
          const hourEnergy =
            safeObject(hour.energy);

          const hourGenerator =
            safeObject(hour.generator);

          const firstStart =
            minuteResults.find(
              minute =>
                minute.hourIndex ===
                  hour.hourIndex &&
                minute
                  .generatorControl
                  ?.started
            ) || null;

          const startHour =
            String(displayIndex)
              .padStart(2, "0");

          const endHour =
            String(
              (displayIndex + 1) % 24
            ).padStart(2, "0");

          const deliveredTotalKWh =
            numberOrNull(
              hourEnergy
                .coveredDemandEnergyKWh
            ) !== null &&
            numberOrNull(
              hourEnergy
                .recirculationLossKWh
            ) !== null
              ? (
                  Number(
                    hourEnergy
                      .coveredDemandEnergyKWh
                  ) +
                  Number(
                    hourEnergy
                      .recirculationLossKWh
                  )
                )
              : null;

          const runningMinutes =
            firstDefined(
              hourGenerator.runningMinutes,
              numberOrNull(
                hourGenerator.runningHours
              ) !== null
                ? Number(
                    hourGenerator.runningHours
                  ) * 60
                : null
            );

          const starts =
            numberOrNull(
              hourGenerator.starts
            );

          const averageMinutesPerStart =
            starts !== null &&
            starts > 0 &&
            numberOrNull(
              runningMinutes
            ) !== null
              ? Number(runningMinutes) / starts
              : null;

          return [
            `${startHour}-${endHour}`,
            formatNumber(
              hourEnergy
                .requestedDemandEnergyKWh,
              2
            ),
            formatNumber(
              hourEnergy
                .recirculationLossKWh,
              2
            ),
            formatNumber(
              deliveredTotalKWh,
              2
            ),
            formatNumber(
              hourEnergy
                .generatedEnergyKWh,
              2
            ),
            formatNumber(
              hourGenerator.starts,
              0
            ),
            firstStart
              ? `${startHour}:${String(
                  firstStart.minuteWithinHour
                ).padStart(2, "0")}`
              : "—",
            runningMinutes === null ||
            runningMinutes === undefined
              ? "—"
              : `${formatNumber(
                  runningMinutes,
                  0
                )} min`,
            averageMinutesPerStart === null
              ? "—"
              : `${formatNumber(
                  averageMinutesPerStart,
                  1
                )} min`
          ];
        }
      );

  return {
    raw: report,
    project,
    inputSummary,
    demand,
    temperatures,
    generator,
    recirculation,
    results,
    energy,
    comfort,
    generatorResults,
    hydraulics,
    tanks: safeArray(report.tanks),
    exchangers: safeArray(results.exchangers),
    conclusions: safeArray(report.conclusions),
    notes: safeArray(report.notes),
    assessments: safeObject(report.assessments),
    charts: safeObject(report.charts),

    demandProfile: (() => {
      const suppliedProfile =
        safeObject(
          firstDefined(
            input.demandProfile,
            input.analysis?.demandProfile,
            report.demandProfile
          )
        );

      const hourlyDemandAt60CL =
        safeArray(
          firstDefined(
            suppliedProfile.hourlyDemandAt60CL,
            demand.hourlyDemandAt60CL,
            demand.hourlyProfileAt60CL
          )
        )
          .slice(0, 24)
          .map(Number);

      return {
        hours:
          safeArray(
            suppliedProfile.hours
          ).length === 24
            ? suppliedProfile.hours
            : Array.from(
                { length: 24 },
                (_value, hourIndex) => ({
                  hourIndex,
                  label:
                    `${String(hourIndex).padStart(2, "0")}:00`
                })
              ),

        hourlyDemandAt60CL,

        referenceTemperatureC:
          numberOrNull(
            firstDefined(
              suppliedProfile.referenceTemperatureC,
              60
            )
          ) ?? 60,

        networkTemperatureC:
          numberOrNull(
            firstDefined(
              suppliedProfile.networkTemperatureC,
              temperatures.networkTemperatureC,
              10
            )
          ) ?? 10
      };
    })(),

    hourlyOperationRows
  };
}


/* ============================================================
 * INICIALIZACIÓN
 * ============================================================ */

function initializeDocument(input) {
  const JsPdf = getJsPdfConstructor();

  const doc = new JsPdf({
    orientation: ACS_REPORT_CONFIG.PAGE.orientation,
    unit: ACS_REPORT_CONFIG.PAGE.unit,
    format: ACS_REPORT_CONFIG.PAGE.format,
    compress: true,
    putOnlyUsedFonts: true
  });

  ReportState.doc = doc;
  ReportState.pageWidth = doc.internal.pageSize.getWidth();
  ReportState.pageHeight = doc.internal.pageSize.getHeight();
  ReportState.contentWidth =
    ReportState.pageWidth -
    ACS_REPORT_CONFIG.MARGIN.left -
    ACS_REPORT_CONFIG.MARGIN.right;

  ReportState.pageNumber = 1;
  ReportState.projectName =
    input.project?.name ||
    input.analysis?.project?.name ||
    input.analysis?.report?.project?.name ||
    "Proyecto";
}


function setFont({
  size = 9,
  style = "normal",
  color = ACS_REPORT_CONFIG.COLORS.text
} = {}) {
  const doc = ReportState.doc;

  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}


/* ============================================================
 * MOTOR DE TEXTO SIN SOLAPES
 * ============================================================ */

/**
 * Divide un texto y limita el número de líneas.
 * Si el texto excede el espacio, añade puntos suspensivos.
 */
function prepareLines(text, width, options = {}) {
  const doc = ReportState.doc;
  const {
    fontSize = 8,
    style = "normal",
    maxLines = null
  } = options;

  setFont({ size: fontSize, style });

  let lines = doc.splitTextToSize(
    String(text ?? ""),
    Math.max(1, width)
  );

  if (maxLines !== null && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);

    const lastIndex = lines.length - 1;
    let lastLine = String(lines[lastIndex] || "");

    while (
      lastLine.length > 0 &&
      doc.getTextWidth(`${lastLine}…`) > width
    ) {
      lastLine = lastLine.slice(0, -1);
    }

    lines[lastIndex] = `${lastLine.trimEnd()}…`;
  }

  return lines;
}


/**
 * Dibuja cada línea por separado.
 * lineGap se expresa en milímetros y nunca depende de jsPDF.
 */
function drawLines(lines, x, y, options = {}) {
  const doc = ReportState.doc;
  const {
    fontSize = 8,
    style = "normal",
    color = ACS_REPORT_CONFIG.COLORS.text,
    lineGap = 4,
    align = "left"
  } = options;

  setFont({ size: fontSize, style, color });

  safeArray(lines).forEach((line, index) => {
    doc.text(
      String(line),
      x,
      y + index * lineGap,
      { align }
    );
  });

  return {
    lineCount: safeArray(lines).length,
    height: Math.max(lineGap, safeArray(lines).length * lineGap)
  };
}


function drawParagraph(text, x, y, width, options = {}) {
  const {
    fontSize = 8.4,
    style = "normal",
    color = ACS_REPORT_CONFIG.COLORS.textSoft,
    lineGap = 4.2,
    maxLines = null,
    align = "left"
  } = options;

  const lines = prepareLines(text, width, {
    fontSize,
    style,
    maxLines
  });

  return drawLines(lines, x, y, {
    fontSize,
    style,
    color,
    lineGap,
    align
  });
}


function drawTextInBox(text, x, y, width, height, options = {}) {
  const {
    fontSize = 8,
    minFontSize = 6.2,
    style = "normal",
    color = ACS_REPORT_CONFIG.COLORS.text,
    lineGap = 4,
    horizontalPadding = 2,
    verticalPadding = 2,
    align = "left",
    verticalAlign = "middle",
    maxLines = null
  } = options;

  const usableWidth = Math.max(1, width - horizontalPadding * 2);
  const usableHeight = Math.max(1, height - verticalPadding * 2);

  let currentFontSize = fontSize;
  let currentLineGap = lineGap;
  let lines = [];

  while (currentFontSize >= minFontSize) {
    const allowedLinesByHeight = Math.max(
      1,
      Math.floor(usableHeight / currentLineGap)
    );

    const effectiveMaxLines =
      maxLines === null
        ? allowedLinesByHeight
        : Math.min(maxLines, allowedLinesByHeight);

    lines = prepareLines(text, usableWidth, {
      fontSize: currentFontSize,
      style,
      maxLines: effectiveMaxLines
    });

    if (lines.length <= allowedLinesByHeight) {
      break;
    }

    currentFontSize -= 0.3;
    currentLineGap = Math.max(3.2, currentLineGap - 0.1);
  }

  const contentHeight = Math.max(
    currentLineGap,
    lines.length * currentLineGap
  );

  let startY = y + verticalPadding + currentFontSize * 0.35;

  if (verticalAlign === "middle") {
    startY =
      y +
      Math.max(0, (height - contentHeight) / 2) +
      currentFontSize * 0.35;
  } else if (verticalAlign === "bottom") {
    startY =
      y +
      height -
      verticalPadding -
      contentHeight +
      currentFontSize * 0.35;
  }

  let textX = x + horizontalPadding;

  if (align === "center") {
    textX = x + width / 2;
  } else if (align === "right") {
    textX = x + width - horizontalPadding;
  }

  return drawLines(lines, textX, startY, {
    fontSize: currentFontSize,
    style,
    color,
    lineGap: currentLineGap,
    align
  });
}


/* ============================================================
 * COMPONENTES DE MAQUETACIÓN
 * ============================================================ */

function drawCard(x, y, width, height, options = {}) {
  const doc = ReportState.doc;
  const {
    fill = ACS_REPORT_CONFIG.COLORS.white,
    border = ACS_REPORT_CONFIG.COLORS.line,
    radius = 2,
    lineWidth = 0.3
  } = options;

  doc.setFillColor(...fill);
  doc.setDrawColor(...border);
  doc.setLineWidth(lineWidth);
  doc.roundedRect(x, y, width, height, radius, radius, "FD");
}


function drawHeader(sectionTitle) {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;

  doc.setFillColor(...colors.navy);
  doc.rect(0, 0, ReportState.pageWidth, 13, "F");

  setFont({
    size: 9,
    style: "bold",
    color: colors.white
  });

  doc.text("PRO ACS", ACS_REPORT_CONFIG.MARGIN.left, 8.5);

  setFont({
    size: 8.3,
    color: colors.white
  });

  doc.text(
    sectionTitle,
    ReportState.pageWidth / 2,
    8.5,
    { align: "center" }
  );

  doc.text(
    ReportState.projectName,
    ReportState.pageWidth - ACS_REPORT_CONFIG.MARGIN.right,
    8.5,
    { align: "right" }
  );
}


function drawFooter() {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;
  const y = ReportState.pageHeight - 8;

  doc.setDrawColor(...colors.line);
  doc.setLineWidth(0.25);
  doc.line(
    ACS_REPORT_CONFIG.MARGIN.left,
    y - 5,
    ReportState.pageWidth - ACS_REPORT_CONFIG.MARGIN.right,
    y - 5
  );

  setFont({
    size: 7.2,
    color: colors.muted
  });

  doc.text(
    `${ACS_REPORT_CONFIG.SOFTWARE_VERSION} · Informe generado automáticamente`,
    ACS_REPORT_CONFIG.MARGIN.left,
    y
  );

  doc.text(
    `Página ${ReportState.pageNumber} de ${ACS_REPORT_CONFIG.PAGE_COUNT}`,
    ReportState.pageWidth - ACS_REPORT_CONFIG.MARGIN.right,
    y,
    { align: "right" }
  );
}


function addPage(sectionTitle) {
  ReportState.doc.addPage();
  ReportState.pageNumber += 1;
  drawHeader(sectionTitle);
  drawFooter();
}


function drawPageTitle(title, subtitle = "") {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;
  const x = ACS_REPORT_CONFIG.MARGIN.left;

  setFont({
    size: 18,
    style: "bold",
    color: colors.navy
  });

  doc.text(title, x, 28);

  doc.setDrawColor(...colors.blue);
  doc.setLineWidth(1.1);
  doc.line(x, 32, x + 34, 32);

  if (subtitle) {
    drawParagraph(
      subtitle,
      x,
      40,
      ReportState.contentWidth,
      {
        fontSize: 8.6,
        color: colors.textSoft,
        lineGap: 4.1,
        maxLines: 2
      }
    );
  }
}


function drawSectionLabel(text, x, y, width = ReportState.contentWidth) {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;

  doc.setFillColor(...colors.blueSoft);
  doc.roundedRect(x, y, width, 10, 2, 2, "F");

  drawTextInBox(
    text,
    x + 2,
    y,
    width - 4,
    10,
    {
      fontSize: 10,
      minFontSize: 8,
      style: "bold",
      color: colors.blue,
      verticalAlign: "middle",
      maxLines: 1
    }
  );
}


function drawMetricCard({
  x,
  y,
  width,
  height = 31,
  label,
  value,
  note = "",
  level = "info"
}) {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;
  const accent = getLevelColor(level);
  const background = getLevelBackground(level);

  drawCard(x, y, width, height, {
    fill: background,
    border: accent,
    radius: 2.5,
    lineWidth: 0.35
  });

  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 3.6, height, 1.8, 1.8, "F");

  drawTextInBox(
    String(label).toUpperCase(),
    x + 7,
    y + 4,
    width - 11,
    7,
    {
      fontSize: 7.4,
      minFontSize: 6,
      style: "bold",
      color: colors.muted,
      maxLines: 1
    }
  );

  drawTextInBox(
    String(value),
    x + 7,
    y + 12,
    width - 11,
    11,
    {
      fontSize: 14.5,
      minFontSize: 9,
      style: "bold",
      color: colors.navy,
      maxLines: 1
    }
  );

  if (note) {
    drawTextInBox(
      String(note),
      x + 7,
      y + 23,
      width - 11,
      6,
      {
        fontSize: 6.9,
        minFontSize: 5.8,
        color: colors.textSoft,
        maxLines: 1
      }
    );
  }
}


function drawKeyValueRows(items, x, y, width, options = {}) {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;
  const {
    rowHeight = 10,
    labelWidth = width * 0.52,
    fontSize = 7.8
  } = options;

  let currentY = y;

  safeArray(items).forEach((item, index) => {
    const fill =
      index % 2 === 0
        ? colors.white
        : colors.surface;

    doc.setFillColor(...fill);
    doc.setDrawColor(...colors.line);
    doc.rect(x, currentY, width, rowHeight, "FD");

    drawTextInBox(
      item.label,
      x + 1,
      currentY,
      labelWidth - 2,
      rowHeight,
      {
        fontSize,
        minFontSize: 6,
        color: colors.textSoft,
        maxLines: 2
      }
    );

    drawTextInBox(
      item.value,
      x + labelWidth,
      currentY,
      width - labelWidth - 1,
      rowHeight,
      {
        fontSize,
        minFontSize: 6,
        style: "bold",
        color: colors.text,
        maxLines: 2
      }
    );

    currentY += rowHeight;
  });

  return currentY;
}


function drawTable({
  x,
  y,
  headers,
  rows,
  widths,
  rowHeight = 10,
  fontSize = 7.2
}) {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;
  let currentY = y;
  let currentX = x;

  headers.forEach((header, index) => {
    const width = widths[index];

    doc.setFillColor(...colors.navy);
    doc.setDrawColor(...colors.navy);
    doc.rect(currentX, currentY, width, rowHeight, "FD");

    drawTextInBox(
      header,
      currentX + 1,
      currentY,
      width - 2,
      rowHeight,
      {
        fontSize,
        minFontSize: 5.8,
        style: "bold",
        color: colors.white,
        maxLines: 2
      }
    );

    currentX += width;
  });

  currentY += rowHeight;

  safeArray(rows).forEach((row, rowIndex) => {
    currentX = x;

    row.forEach((cell, columnIndex) => {
      const width = widths[columnIndex];
      const fill =
        rowIndex % 2 === 0
          ? colors.white
          : colors.surface;

      doc.setFillColor(...fill);
      doc.setDrawColor(...colors.line);
      doc.rect(currentX, currentY, width, rowHeight, "FD");

      drawTextInBox(
        cell,
        currentX + 1,
        currentY,
        width - 2,
        rowHeight,
        {
          fontSize,
          minFontSize: 5.8,
          color: colors.textSoft,
          maxLines: 2
        }
      );

      currentX += width;
    });

    currentY += rowHeight;
  });

  return currentY;
}


function drawDonut({
  centerX,
  centerY,
  radius,
  percent,
  label
}) {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;
  const normalized = Math.max(
    0,
    Math.min(100, numberOrNull(percent) ?? 0)
  );

  doc.setDrawColor(...colors.line);
  doc.setLineWidth(6.5);
  doc.circle(centerX, centerY, radius, "S");

  doc.setDrawColor(...colors.blue);
  doc.setLineWidth(6.5);

  const segments = 72;
  const active = Math.round(segments * normalized / 100);

  for (let index = 0; index < active; index += 1) {
    const start =
      -Math.PI / 2 +
      index * 2 * Math.PI / segments;

    const end =
      -Math.PI / 2 +
      (index + 0.72) * 2 * Math.PI / segments;

    doc.line(
      centerX + radius * Math.cos(start),
      centerY + radius * Math.sin(start),
      centerX + radius * Math.cos(end),
      centerY + radius * Math.sin(end)
    );
  }

  setFont({
    size: 17,
    style: "bold",
    color: colors.navy
  });

  doc.text(
    formatPercent(normalized, 0),
    centerX,
    centerY + 2,
    { align: "center" }
  );

  drawTextInBox(
    String(label).toUpperCase(),
    centerX - radius,
    centerY + 7,
    radius * 2,
    8,
    {
      fontSize: 7,
      minFontSize: 6,
      style: "bold",
      color: colors.muted,
      align: "center",
      maxLines: 1
    }
  );

  doc.setLineWidth(0.3);
}



function getChartImage(view, chartData) {
  if (
    !window.ACSCharts ||
    typeof window.ACSCharts.getChartImage !== "function"
  ) {
    return null;
  }

  try {
    return window.ACSCharts.getChartImage(view, chartData);
  } catch (error) {
    console.warn(
      `No se pudo generar la gráfica "${view}".`,
      error
    );

    return null;
  }
}


function drawChart(image, x, y, width, height, fallbackText) {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;

  drawCard(x, y, width, height, {
    fill: colors.white,
    border: colors.line
  });

  if (image) {
    try {
      doc.addImage(
        image,
        "PNG",
        x + 3,
        y + 3,
        width - 6,
        height - 6,
        undefined,
        "FAST"
      );

      return;
    } catch (error) {
      console.warn("No se pudo insertar una gráfica.", error);
    }
  }

  doc.setDrawColor(...colors.line);
  doc.line(
    x + 8,
    y + height / 2,
    x + width - 8,
    y + height / 2
  );

  drawTextInBox(
    fallbackText,
    x + 8,
    y + height / 2 - 9,
    width - 16,
    18,
    {
      fontSize: 8,
      color: colors.muted,
      align: "center",
      maxLines: 2
    }
  );
}


/* ============================================================
 * TEXTOS AUTOMÁTICOS
 * ============================================================ */

function buildExecutiveText(data) {
  const coverage = numberOrNull(data.comfort.coveragePercent);
  const runningHours = numberOrNull(
    data.generatorResults.runningHours
  );

  const sentences = [
    "La simulación se ha ejecutado durante 48 horas con un paso de cálculo de 1 minuto.",
    "Los indicadores y conclusiones corresponden exclusivamente a las últimas 24 horas; las primeras 24 horas se utilizan como periodo de estabilización."
  ];

  if (coverage !== null) {
    if (coverage >= 95) {
      sentences.push(
        "La instalación cubre prácticamente toda la demanda del periodo analizado."
      );
    } else if (coverage >= 80) {
      sentences.push(
        "La cobertura es adecuada, aunque existen periodos puntuales de menor disponibilidad."
      );
    } else {
      sentences.push(
        "La cobertura obtenida aconseja revisar la configuración de la instalación."
      );
    }
  }

  if (runningHours !== null) {
    sentences.push(
      `El generador funciona durante ${formatNumber(runningHours, 2)} horas en el periodo evaluado.`
    );
  }

  return sentences.join(" ");
}


/* ============================================================
 * PÁGINA 1 · PORTADA
 * ============================================================ */

function drawCoverPage(data) {
  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;
  const x = ACS_REPORT_CONFIG.MARGIN.left;

  doc.setFillColor(...colors.navy);
  doc.rect(0, 0, ReportState.pageWidth, 88, "F");

  doc.setFillColor(...colors.blue);
  doc.rect(0, 88, ReportState.pageWidth, 5, "F");

  setFont({
    size: 29,
    style: "bold",
    color: colors.white
  });

  doc.text("PRO ACS", x, 29);

  setFont({
    size: 13,
    color: colors.white
  });

  doc.text("INFORME TÉCNICO DE SIMULACIÓN", x, 50);

  setFont({
    size: 18,
    style: "bold",
    color: colors.white
  });

  doc.text("Agua Caliente Sanitaria", x, 65);

  drawTextInBox(
    data.project.name || "Proyecto sin nombre",
    x,
    108,
    ReportState.contentWidth,
    25,
    {
      fontSize: 21,
      minFontSize: 14,
      style: "bold",
      color: colors.navy,
      verticalAlign: "top",
      maxLines: 2
    }
  );

  const location = [
    data.project.address,
    data.project.postalCode,
    data.project.city
  ].filter(Boolean).join(", ");

  const metadata = [
    ["Proyectista", data.project.designer || "—"],
    ["Fecha del proyecto", formatDate(data.project.date)],
    ["Ubicación", location || "—"],
    ["Versión del informe", ACS_REPORT_CONFIG.VERSION],
    ["Versión de la aplicación", ACS_REPORT_CONFIG.SOFTWARE_VERSION]
  ];

  let y = 144;

  metadata.forEach(([label, value]) => {
    drawTextInBox(
      String(label).toUpperCase(),
      x,
      y,
      ReportState.contentWidth,
      6,
      {
        fontSize: 7.2,
        minFontSize: 6,
        style: "bold",
        color: colors.muted,
        verticalAlign: "top",
        maxLines: 1
      }
    );

    drawTextInBox(
      value,
      x,
      y + 6,
      ReportState.contentWidth,
      10,
      {
        fontSize: 9.8,
        minFontSize: 7.5,
        color: colors.text,
        verticalAlign: "top",
        maxLines: 2
      }
    );

    y += 20;
  });

  drawCard(
    x,
    244,
    ReportState.contentWidth,
    29,
    {
      fill: colors.surface,
      border: colors.line
    }
  );

  drawTextInBox(
    "DOCUMENTO GENERADO AUTOMÁTICAMENTE",
    x + 5,
    250,
    ReportState.contentWidth - 10,
    7,
    {
      fontSize: 8.4,
      minFontSize: 7,
      style: "bold",
      color: colors.navy,
      verticalAlign: "top",
      maxLines: 1
    }
  );

  drawParagraph(
    "Los resultados deben ser revisados y validados por el usuario o técnico responsable antes de utilizarse en decisiones de diseño, dimensionado, ejecución o explotación.",
    x + 5,
    262,
    ReportState.contentWidth - 10,
    {
      fontSize: 7.7,
      lineGap: 4,
      color: colors.textSoft,
      maxLines: 2
    }
  );

  setFont({
    size: 7.2,
    color: colors.muted
  });

  doc.text(
    "Pro ACS · Informe técnico de simulación",
    x,
    ReportState.pageHeight - 10
  );

  doc.text(
    "Página 1 de 10",
    ReportState.pageWidth - ACS_REPORT_CONFIG.MARGIN.right,
    ReportState.pageHeight - 10,
    { align: "right" }
  );
}


/* ============================================================
 * PÁGINA 2 · RESUMEN
 * ============================================================ */

function drawExecutivePage(data) {
  addPage("Resumen ejecutivo");

  const colors = ACS_REPORT_CONFIG.COLORS;
  const x = ACS_REPORT_CONFIG.MARGIN.left;
  const gap = 5;
  const cardWidth = (ReportState.contentWidth - gap * 2) / 3;

  drawPageTitle(
    "Resumen ejecutivo",
    "Principales indicadores del periodo analizado."
  );

  drawMetricCard({
    x,
    y: 53,
    width: cardWidth,
    label: "Demanda",
    value: formatEnergy(data.energy.demandKWh),
    note: "Últimas 24 horas"
  });

  drawMetricCard({
    x: x + cardWidth + gap,
    y: 53,
    width: cardWidth,
    label: "Cobertura",
    value: formatPercent(data.comfort.coveragePercent),
    note: "Demanda cubierta",
    level:
      numberOrNull(data.comfort.coveragePercent) >= 90
        ? "success"
        : "warning"
  });


  drawMetricCard({
    x,
    y: 89,
    width: cardWidth,
    label: "Energía generada",
    value: formatEnergy(data.energy.generatedKWh),
    note: "Aporte del generador"
  });

  drawMetricCard({
    x: x + cardWidth + gap,
    y: 89,
    width: cardWidth,
    label: "Funcionamiento",
    value: `${formatNumber(data.generatorResults.runningHours, 2)} h`,
    note: "Tiempo del generador"
  });

  drawMetricCard({
    x: x + (cardWidth + gap) * 2,
    y: 89,
    width: cardWidth,
    label: "Arranques",
    value: formatNumber(data.generatorResults.starts, 0),
    note: "Ciclos registrados"
  });

  drawCard(
    x,
    130,
    ReportState.contentWidth,
    68,
    {
      fill: colors.white,
      border: colors.line
    }
  );

  drawSectionLabel(
    "Interpretación general",
    x + 5,
    136,
    ReportState.contentWidth - 10
  );

  drawParagraph(
    buildExecutiveText(data),
    x + 8,
    155,
    ReportState.contentWidth - 79,
    {
      fontSize: 8.2,
      lineGap: 4.3,
      color: colors.textSoft,
      maxLines: 7
    }
  );

  drawDonut({
    centerX: ReportState.pageWidth - 47,
    centerY: 168,
    radius: 20,
    percent: data.comfort.coveragePercent,
    label: "Cobertura"
  });

  drawSectionLabel(
    "Criterio temporal del informe",
    x,
    207
  );

  drawCard(
    x,
    222,
    ReportState.contentWidth,
    50,
    {
      fill: colors.blueSoft,
      border: colors.blue
    }
  );

  const columns = [
    {
      x: x + 9,
      value: "48 h",
      label: "SIMULACIÓN TOTAL"
    },
    {
      x: x + 65,
      value: "1 min",
      label: "PASO DE CÁLCULO"
    },
    {
      x: x + 121,
      value: "24 h",
      label: "PERIODO ANALIZADO"
    }
  ];

  columns.forEach(column => {
    drawTextInBox(
      column.value,
      column.x,
      229,
      45,
      8,
      {
        fontSize: 11,
        minFontSize: 9,
        style: "bold",
        color: colors.navy,
        maxLines: 1
      }
    );

    drawTextInBox(
      column.label,
      column.x,
      239,
      49,
      8,
      {
        fontSize: 7.1,
        minFontSize: 6,
        color: colors.textSoft,
        maxLines: 1
      }
    );
  });

  drawParagraph(
    "Las primeras 24 horas se emplean como periodo de estabilización. Las tablas, gráficas, indicadores, diagnósticos y conclusiones se refieren a las últimas 24 horas.",
    x + 9,
    257,
    ReportState.contentWidth - 18,
    {
      fontSize: 7.6,
      lineGap: 4,
      color: colors.textSoft,
      maxLines: 2
    }
  );
}


/* ============================================================
 * PÁGINA 3 · DATOS DE ENTRADA
 * ============================================================ */

function drawInputsPage(data) {
  addPage("Datos de entrada");

  const x = ACS_REPORT_CONFIG.MARGIN.left;
  const half = (ReportState.contentWidth - 6) / 2;

  drawPageTitle(
    "Datos de entrada",
    "Parámetros utilizados para construir el modelo."
  );

  drawSectionLabel("Demanda y temperaturas", x, 52, half);

  drawKeyValueRows(
    [
      {
        label: "Perfil de demanda",
        value: getProfileName(data.demand.profileType)
      },
      {
        label: "Número de personas",
        value: formatNumber(data.demand.numberOfPeople, 0)
      },
      {
        label: "Consumo unitario",
        value:
          `${formatNumber(
            data.demand.unitVolumeAt60CPerPersonDayL,
            2
          )} L/persona·día`
      },
      {
        label: "Demanda diaria",
        value:
          `${formatNumber(
            data.demand.totalDailyDemandAt60CL,
            2
          )} L/día a 60 °C`
      },
      {
        label: "Tª acumulación",
        value: formatTemperature(
          data.temperatures.storageTemperatureC
        )
      },
      {
        label: "Tª de uso",
        value: formatTemperature(
          data.temperatures.useTemperatureC
        )
      },
      {
        label: "Tª de red",
        value: formatTemperature(
          data.temperatures.networkTemperatureC
        )
      }
    ],
    x,
    66,
    half,
    {
      rowHeight: 10
    }
  );

  drawSectionLabel(
    "Generador y recirculación",
    x + half + 6,
    52,
    half
  );

  drawKeyValueRows(
    [
      {
        label: "Potencia del generador",
        value: `${formatNumber(data.generator.powerKW, 2)} kW`
      },
      {
        label: "Umbral de arranque",
        value: formatPercent(
          data.generator.startThresholdPercent
        )
      },
      {
        label: "Pérdidas configuradas",
        value: formatPercent(
          firstDefined(
            data.recirculation.lossPercent,
            data.inputSummary.lossPercent,
            data.energy.lossesPercentOfDemand
          )
        )
      },
      {
        label: "Caudal de retorno",
        value: formatFlow(
          firstDefined(
            data.recirculation.flowLPerMinute,
            data.hydraulics.totalReturnFlowLPerMinute
          )
        )
      },
      {
        label: "Comprobación sanitaria",
        value:
          data.inputSummary.sanitaryCheck
            ? "Activada"
            : "No solicitada"
      },
      {
        label: "Número de depósitos",
        value: formatNumber(
          firstDefined(
            data.inputSummary.tankCount,
            data.tanks.length
          ),
          0
        )
      },
      {
        label: "Modelo temporal",
        value: "48 h · paso 1 min"
      }
    ],
    x + half + 6,
    66,
    half,
    {
      rowHeight: 10
    }
  );

  drawSectionLabel(
    "Configuración de acumuladores",
    x,
    147
  );

  const tankRows = data.tanks.map((tank, index) => [
    tank.tankId || tank.id || `D${index + 1}`,
    `${formatNumber(tank.volumeL, 0)} L`,
    `${formatNumber(tank.exchangerPowerKW, 2)} kW`,
    formatEnergy(tank.maximumUsefulEnergyKWh),
    formatDurationMinutes(tank.heatingTimeMinutes),
    formatPercent(tank.minimumLoadPercent)
  ]);

  drawTable({
    x,
    y: 161,
    headers: [
      "Depósito",
      "Volumen",
      "Potencia",
      "Energía útil",
      "Calentamiento",
      "Carga mínima"
    ],
    rows:
      tankRows.length > 0
        ? tankRows
        : [["—", "—", "—", "—", "—", "—"]],
    widths: [24, 27, 29, 34, 38, 26],
    rowHeight: 10,
    fontSize: 7
  });

  drawSectionLabel(
    "Datos generales del proyecto",
    x,
    207
  );

  const location = [
    data.project.address,
    data.project.postalCode,
    data.project.city
  ].filter(Boolean).join(", ");

  drawKeyValueRows(
    [
      {
        label: "Proyecto",
        value: data.project.name || "—"
      },
      {
        label: "Proyectista",
        value: data.project.designer || "—"
      },
      {
        label: "Fecha",
        value: formatDate(data.project.date)
      },
      {
        label: "Ubicación",
        value: location || "—"
      }
    ],
    x,
    221,
    ReportState.contentWidth,
    {
      rowHeight: 10,
      labelWidth: 53
    }
  );
}


/* ============================================================
 * PÁGINA 4 · METODOLOGÍA
 * ============================================================ */

function drawMethodologyPage() {
  addPage("Metodología y configuración");

  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;
  const x = ACS_REPORT_CONFIG.MARGIN.left;

  drawPageTitle(
    "Metodología y configuración",
    "Alcance temporal y criterio de lectura del informe."
  );

  drawSectionLabel("Proceso de simulación", x, 52);

  const steps = [
    {
      title: "Inicialización",
      text:
        "El motor construye el estado inicial de los depósitos y normaliza los parámetros de entrada."
    },
    {
      title: "Simulación minuto a minuto",
      text:
        "El comportamiento hidráulico y energético se calcula mediante intervalos consecutivos de 1 minuto durante 48 horas."
    },
    {
      title: "Periodo de estabilización",
      text:
        "Las primeras 24 horas reducen la influencia de las condiciones iniciales sobre el resultado."
    },
    {
      title: "Periodo analizado",
      text:
        "Los resultados presentados corresponden a los minutos 1.441 a 2.880, equivalentes a las últimas 24 horas."
    }
  ];

  let y = 68;

  steps.forEach((step, index) => {
    drawCard(
      x,
      y,
      ReportState.contentWidth,
      34,
      {
        fill:
          index % 2 === 0
            ? colors.white
            : colors.surface,
        border: colors.line
      }
    );

    doc.setFillColor(...colors.blue);
    doc.circle(x + 9, y + 9, 4.5, "F");

    setFont({
      size: 8,
      style: "bold",
      color: colors.white
    });

    doc.text(
      String(index + 1),
      x + 9,
      y + 11.3,
      { align: "center" }
    );

    drawTextInBox(
      step.title,
      x + 18,
      y + 4,
      ReportState.contentWidth - 24,
      8,
      {
        fontSize: 9.5,
        minFontSize: 8,
        style: "bold",
        color: colors.navy,
        maxLines: 1
      }
    );

    drawParagraph(
      step.text,
      x + 18,
      y + 18,
      ReportState.contentWidth - 24,
      {
        fontSize: 8,
        lineGap: 4,
        color: colors.textSoft,
        maxLines: 3
      }
    );

    y += 39;
  });

  drawSectionLabel("Criterios de interpretación", x, 228);

  drawCard(
    x,
    242,
    ReportState.contentWidth,
    34,
    {
      fill: colors.blueSoft,
      border: colors.blue
    }
  );

  drawParagraph(
    "Pro ACS es una herramienta de simulación y apoyo al análisis. Los resultados expresan el comportamiento del modelo bajo las condiciones introducidas y deben interpretarse junto con las características reales de la instalación, los criterios del proyectista y la normativa aplicable.",
    x + 6,
    251,
    ReportState.contentWidth - 12,
    {
      fontSize: 8,
      lineGap: 4.1,
      color: colors.textSoft,
      maxLines: 5
    }
  );
}


/* ============================================================
 * PÁGINA 5 · BALANCE
 * ============================================================ */

function drawEnergyPage(data) {
  addPage("Balance energético");

  const x = ACS_REPORT_CONFIG.MARGIN.left;
  const half = (ReportState.contentWidth - 8) / 2;

  drawPageTitle(
    "Balance energético",
    "Resultados agregados de las últimas 24 horas."
  );

  drawSectionLabel("Energía", x, 52, half);

  drawKeyValueRows(
    [
      {
        label: "Demanda",
        value: formatEnergy(data.energy.demandKWh)
      },
      {
        label: "Pérdidas",
        value: formatEnergy(data.energy.lossesKWh)
      },
      {
        label: "Demanda + pérdidas",
        value: formatEnergy(data.energy.demandPlusLossesKWh)
      },
      {
        label: "Energía generada",
        value: formatEnergy(data.energy.generatedKWh)
      },
      {
        label: "Déficit",
        value: formatEnergy(data.energy.deficitKWh)
      }
    ],
    x,
    66,
    half,
    {
      rowHeight: 12
    }
  );

  drawSectionLabel(
    "Operación",
    x + half + 8,
    52,
    half
  );

  drawKeyValueRows(
    [
      {
        label: "Cobertura energética",
        value: formatPercent(data.comfort.coveragePercent)
      },
      {
        label: "Funcionamiento generador",
        value:
          `${formatNumber(
            data.generatorResults.runningHours,
            2
          )} h`
      },
      {
        label: "Arranques",
        value: formatNumber(data.generatorResults.starts, 0)
      },
      {
        label: "Caudal máximo de uso",
        value: formatFlow(
          data.hydraulics.maximumUseFlowLPerMinute
        )
      },
      {
        label: "Caudal total de retorno",
        value: formatFlow(
          data.hydraulics.totalReturnFlowLPerMinute
        )
      }
    ],
    x + half + 8,
    66,
    half,
    {
      rowHeight: 12
    }
  );

  drawSectionLabel("Indicadores principales", x, 137);

  drawDonut({
    centerX: x + 42,
    centerY: 184,
    radius: 25,
    percent: data.comfort.coveragePercent,
    label: "Cobertura"
  });

  drawDonut({
    centerX: x + 105,
    centerY: 184,
    radius: 25,
    percent:
      100 -
      Math.max(
        0,
        Math.min(
          100,
          numberOrNull(data.energy.lossesPercentOfDemand) ?? 0
        )
      ),
    label: "Energía útil"
  });

    drawSectionLabel(
    "Funcionamiento de los intercambiadores",
    x,
    226
  );

  const exchangerRows = data.exchangers.map((item, index) => [
    item.tankId || `D${index + 1}`,
    `${formatNumber(item.runningHours, 2)} h`,
    formatEnergy(item.generatedEnergyKWh)
  ]);

  drawTable({
    x,
    y: 240,
    headers: [
      "Intercambiador",
      "Funcionamiento",
      "Energía generada"
    ],
    rows:
      exchangerRows.length > 0
        ? exchangerRows
        : [["—", "—", "—"]],
    widths: [55, 55, 68],
    rowHeight: 10,
    fontSize: 7.5
  });
}


/* ============================================================
 * PÁGINA 6 · PERFIL DE DEMANDA Y CARGA
 * ============================================================ */

function drawDemandAndLoadChartsPage(data) {
  addPage("Evolución temporal · Demanda y carga");

  const x = ACS_REPORT_CONFIG.MARGIN.left;

  drawPageTitle(
    "Evolución temporal",
    "Perfil horario de demanda y estado de carga de los depósitos durante las últimas 24 horas."
  );

  drawSectionLabel(
    "Perfil horario de demanda",
    x,
    48
  );

  drawChart(
    getChartImage(
      "demand",
      data.demandProfile
    ),
    x,
    61,
    ReportState.contentWidth,
    88,
    "Gráfica del perfil horario de demanda no disponible."
  );

  drawSectionLabel(
    "Carga de los depósitos",
    x,
    160
  );

  drawChart(
    getChartImage(
      "load",
      data.charts
    ),
    x,
    173,
    ReportState.contentWidth,
    88,
    "Gráfica de carga no disponible."
  );
}


/* ============================================================
 * PÁGINA 7 · ENERGÍA Y POTENCIA
 * ============================================================ */

function drawEnergyAndPowerChartsPage(data) {
  addPage("Evolución temporal · Energía y potencia");

  const x = ACS_REPORT_CONFIG.MARGIN.left;

  drawPageTitle(
    "Energía y potencia",
    "Energía entregada por hora y potencia instantánea de los equipos durante las últimas 24 horas."
  );

  drawSectionLabel(
    "Energía entregada por hora",
    x,
    48
  );

  drawChart(
    getChartImage(
      "hourlyEnergy",
      data.charts
    ),
    x,
    61,
    ReportState.contentWidth,
    88,
    "Gráfica de energía entregada por hora no disponible."
  );

  drawSectionLabel(
    "Potencia instantánea",
    x,
    160
  );

  drawChart(
    getChartImage(
      "power",
      data.charts
    ),
    x,
    173,
    ReportState.contentWidth,
    88,
    "Gráfica de potencia instantánea no disponible."
  );
}


/* ============================================================
 * PÁGINA 8 · TABLA HORARIA DE OPERACIÓN
 * ============================================================ */

function drawOperationTablePage(data) {
  addPage("Tabla horaria de operación");

  const x = ACS_REPORT_CONFIG.MARGIN.left;

  drawPageTitle(
    "Tabla horaria de operación",
    "Balance energético y funcionamiento del generador durante cada hora de las últimas 24 horas."
  );

  drawSectionLabel(
    "Resultados horarios",
    x,
    48
  );

  drawTable({
    x,
    y: 61,
    headers: [
      "Hora",
      "Dem.",
      "Pérd.",
      "Entreg.",
      "Gener.",
      "Arr.",
      "1er arr.",
      "Func.",
      "T. medio"
    ],
    rows:
      data.hourlyOperationRows.length > 0
        ? data.hourlyOperationRows
        : [["—", "—", "—", "—", "—", "—", "—", "—", "—"]],
    widths: [18, 20, 18, 20, 20, 14, 22, 22, 24],
    rowHeight: 8.2,
    fontSize: 5.9
  });

  const currentView =
    window.ACSApp?.state?.currentChartView || "load";

  if (
    window.ACSCharts &&
    typeof window.ACSCharts.render === "function"
  ) {
    try {
      window.ACSCharts.render(
        currentView,
        data.charts
      );
    } catch (error) {
      console.warn(
        "No se pudo restaurar la gráfica activa.",
        error
      );
    }
  }
}


/* ============================================================
 * PÁGINA 9 · DIAGNÓSTICO
 * ============================================================ */

function drawDiagnosisPage(data) {
  addPage("Diagnóstico");

  const x = ACS_REPORT_CONFIG.MARGIN.left;
  const colors = ACS_REPORT_CONFIG.COLORS;

  drawPageTitle(
    "Diagnóstico",
    "Interpretación automática de los resultados del periodo analizado."
  );

  /*
   * Las cuatro gráficas del informe ya se muestran consecutivamente
   * en las páginas 6 y 7, inmediatamente antes de la tabla horaria.
   * No se repite aquí la gráfica de carga.
   */
  drawSectionLabel("Valoraciones técnicas", x, 52);

  const assessments = [];

  if (data.assessments.sanitary) {
    assessments.push({
      title: "Comprobación sanitaria",
      assessment: safeObject(data.assessments.sanitary)
    });
  }

  assessments.push({
    title: "Confort",
    assessment: safeObject(data.assessments.comfort)
  });

  let y = 68;

  assessments.slice(0, 3).forEach(item => {
    const level = item.assessment.level || "info";
    const description = [
      item.assessment.label,
      item.assessment.reportText ||
        item.assessment.message
    ].filter(Boolean).join(". ");

    drawCard(
      x,
      y,
      ReportState.contentWidth,
      42,
      {
        fill: getLevelBackground(level),
        border: getLevelColor(level)
      }
    );

    ReportState.doc.setFillColor(
      ...getLevelColor(level)
    );

    ReportState.doc.circle(
      x + 8,
      y + 9,
      2.5,
      "F"
    );

    drawTextInBox(
      item.title,
      x + 14,
      y + 3,
      ReportState.contentWidth - 21,
      9,
      {
        fontSize: 9.2,
        minFontSize: 8,
        style: "bold",
        color: getLevelColor(level),
        maxLines: 1
      }
    );

    drawParagraph(
      description || "Sin valoración disponible.",
      x + 14,
      y + 18,
      ReportState.contentWidth - 21,
      {
        fontSize: 7.8,
        lineGap: 4,
        color: colors.textSoft,
        maxLines: 5
      }
    );

    y += 49;
  });

  drawSectionLabel(
    "Lectura conjunta de los resultados",
    x,
    Math.max(181, y + 4)
  );

  drawCard(
    x,
    Math.max(196, y + 19),
    ReportState.contentWidth,
    58,
    {
      fill: colors.surface,
      border: colors.line
    }
  );

  drawParagraph(
    "El perfil horario permite identificar cuándo se concentra la demanda. La gráfica de carga muestra la respuesta de la acumulación, la energía horaria cuantifica el aporte útil de cada intercambiador y la potencia instantánea permite comprobar los periodos reales de funcionamiento y sus límites. La tabla siguiente a las gráficas completa esta lectura con el balance de cada hora.",
    x + 7,
    Math.max(208, y + 31),
    ReportState.contentWidth - 14,
    {
      fontSize: 8.1,
      lineGap: 4.2,
      color: colors.textSoft,
      maxLines: 8
    }
  );
}


/* ============================================================
 * PÁGINA 10 · CONCLUSIONES Y RESPONSABILIDAD
 * ============================================================ */

function drawConclusionsPage(data) {
  addPage("Conclusiones y responsabilidad");

  const doc = ReportState.doc;
  const colors = ACS_REPORT_CONFIG.COLORS;
  const x = ACS_REPORT_CONFIG.MARGIN.left;

  drawPageTitle(
    "Conclusiones",
    "Síntesis técnica y condiciones de uso del informe."
  );

  drawSectionLabel("Conclusiones de la simulación", x, 52);

  let conclusions =
    data.conclusions.filter(c=>!(JSON.stringify(c).toLowerCase().includes('recircul'))).length>0
      ? data.conclusions.filter(c=>!(JSON.stringify(c).toLowerCase().includes('recircul')))
      : [
          {
            title: "Resultado",
            text:
              "No se han generado conclusiones automáticas adicionales.",
            level: "info"
          }
        ];

  let y = 68;

  conclusions.slice(0, 4).forEach(item => {
    const normalized =
      typeof item === "string"
        ? {
            title: "Observación",
            text: item,
            level: "info"
          }
        : item;

    const level = normalized.level || "info";
    const text = [
      normalized.title,
      normalized.text
    ].filter(Boolean).join(": ");

    drawCard(
      x,
      y,
      ReportState.contentWidth,
      24,
      {
        fill: getLevelBackground(level),
        border: getLevelColor(level)
      }
    );

    doc.setFillColor(...getLevelColor(level));
    doc.circle(x + 7, y + 8, 2, "F");

    drawParagraph(
      text,
      x + 13,
      y + 8,
      ReportState.contentWidth - 18,
      {
        fontSize: 7.7,
        lineGap: 3.9,
        color: colors.textSoft,
        maxLines: 4
      }
    );

    y += 28;
  });

  const liabilityY = Math.max(157, y + 3);

  drawSectionLabel(
    "Cláusula de uso y responsabilidad",
    x,
    liabilityY
  );

  const paragraphs = [
    "El presente informe ha sido generado automáticamente por Pro ACS a partir de los datos introducidos por el usuario y de los modelos de cálculo implementados en la aplicación.",
    "Los resultados representan una simulación del comportamiento esperado bajo las condiciones definidas y no constituyen una certificación, una garantía de funcionamiento real ni sustituyen el juicio profesional.",
    "Corresponde al usuario comprobar que los datos de entrada son correctos, completos y representativos, validar la coherencia de los resultados y verificar su adecuación a la instalación, al proyecto y a la normativa aplicable.",
    "Las decisiones de diseño, dimensionado, ejecución, puesta en servicio, mantenimiento o explotación deberán ser adoptadas por personal técnico competente.",
    "Los responsables de Pro ACS no responderán de las consecuencias derivadas de datos incorrectos o incompletos, interpretaciones inadecuadas, usos distintos de los previstos o decisiones adoptadas exclusivamente a partir de este informe."
  ];

  let clauseY = liabilityY + 17;

  paragraphs.forEach((paragraph, index) => {
    const result = drawParagraph(
      paragraph,
      x + 4,
      clauseY,
      ReportState.contentWidth - 8,
      {
        fontSize: 7.3,
        lineGap: 3.8,
        color: colors.textSoft,
        maxLines: 3
      }
    );

    clauseY += result.height + 3;

    if (index < paragraphs.length - 1) {
      doc.setDrawColor(...colors.line);
      doc.line(
        x + 4,
        clauseY - 1.5,
        x + ReportState.contentWidth - 4,
        clauseY - 1.5
      );
    }
  });

  drawCard(
    x,
    268,
    ReportState.contentWidth,
    14,
    {
      fill: colors.navy,
      border: colors.navy
    }
  );

  drawTextInBox(
    "La generación del informe no implica la validación automática de los datos ni de la solución técnica.",
    x + 5,
    268,
    ReportState.contentWidth - 10,
    14,
    {
      fontSize: 7.8,
      minFontSize: 6.5,
      style: "bold",
      color: colors.white,
      align: "center",
      maxLines: 2
    }
  );
}


/* ============================================================
 * GENERACIÓN
 * ============================================================ */

function buildPdf(input) {
  validateInput(input);
  initializeDocument(input);

  const data = normalizeReportData(input);

  drawCoverPage(data);
  drawExecutivePage(data);
  drawInputsPage(data);
  drawMethodologyPage(data);
  drawEnergyPage(data);
  drawDemandAndLoadChartsPage(data);
  drawEnergyAndPowerChartsPage(data);
  drawOperationTablePage(data);
  drawDiagnosisPage(data);
  drawConclusionsPage(data);

  return ReportState.doc;
}


function generatePdf(input) {
  try {
    const doc = buildPdf(input);

    const projectName =
      input.project?.name ||
      input.analysis?.project?.name ||
      input.analysis?.report?.project?.name ||
      "Proyecto";

    const projectDate =
      input.project?.date ||
      input.analysis?.project?.date ||
      input.analysis?.report?.project?.date ||
      new Date().toISOString().slice(0, 10);

    const fileName =
      `Informe_Tecnico_ACS_${sanitizeFileName(
        projectName
      )}_${projectDate}.pdf`;

    doc.save(fileName);

    if (
      window.ACSApp &&
      typeof window.ACSApp.showMessage === "function"
    ) {
      window.ACSApp.showMessage(
        `Informe generado como "${fileName}".`,
        "success"
      );
    }

    return {
      fileName,
      document: doc
    };
  } catch (error) {
    console.error(error);

    if (
      window.ACSApp &&
      typeof window.ACSApp.showMessage === "function"
    ) {
      window.ACSApp.showMessage(
        error.message ||
          "No se ha podido generar el informe PDF.",
        "error"
      );
    }

    throw error;
  }
}


/* ============================================================
 * API PÚBLICA
 * ============================================================ */

const ACSReport = Object.freeze({
  version: ACS_REPORT_CONFIG.VERSION,
  buildPdf,
  generatePdf
});


if (typeof window !== "undefined") {
  window.ACSReport = ACSReport;
}


if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = {
    ACSReport,
    ACSReportError,
    ACS_REPORT_CONFIG
  };
}