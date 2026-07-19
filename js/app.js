"use strict";

/**
 * ============================================================
 * PRO ACS
 * Control general de la aplicación
 * ============================================================
 *
 * Responsabilidades:
 *
 * - Navegación entre las tres pantallas.
 * - Lectura y validación de formularios.
 * - Generación de la demanda horaria.
 * - Selección del reparto intrahorario.
 * - Ejecución del motor ACS.
 * - Coordinación con Block 7, gráficas, almacenamiento e informe.
 *
 * Este archivo no contiene cálculos físicos.
 */


/* ============================================================
 * ESTADO GENERAL DE LA APLICACIÓN
 * ============================================================ */

const ACSAppState = {
  currentScreen: "project",

  projectData: null,

  inputConfig: null,

  simulationResult: null,

  analysisResult: null,

  demandProfilePreview: null,

  hasCalculated: false,

  currentChartView: "load"
};


const ALLOWED_CHART_VIEWS = Object.freeze([
  "load",
  "hourlyEnergy",
  "power"
]);


/* ============================================================
 * REFERENCIAS DEL DOM
 * ============================================================ */

const DOM = {};


/**
 * Obtiene un elemento por su ID.
 */
function getElement(id) {
  const element =
    document.getElementById(id);

  if (!element) {
    throw new Error(
      `No se ha encontrado el elemento #${id}.`
    );
  }

  return element;
}


/**
 * Guarda las referencias principales de la interfaz.
 */
function cacheDOMElements() {
  DOM.projectScreen =
    getElement("projectScreen");

  DOM.inputsScreen =
    getElement("inputsScreen");

  DOM.resultsScreen =
    getElement("resultsScreen");

  DOM.projectForm =
    getElement("projectForm");

  DOM.simulationForm =
    getElement("simulationForm");

  DOM.globalMessage =
    getElement("globalMessage");

  DOM.simulationStatus =
    getElement("simulationStatus");

  DOM.stepProjectButton =
    getElement("stepProjectButton");

  DOM.stepInputsButton =
    getElement("stepInputsButton");

  DOM.stepResultsButton =
    getElement("stepResultsButton");

  DOM.continueToInputsButton =
    getElement("continueToInputsButton");

  DOM.backToProjectButton =
    getElement("backToProjectButton");

  DOM.backToInputsButton =
    getElement("backToInputsButton");

  DOM.calculateButton =
    getElement("calculateButton");

  DOM.newProjectButton =
    getElement("newProjectButton");

  DOM.openProjectButton =
    getElement("openProjectButton");

  DOM.saveProjectButton =
    getElement("saveProjectButton");

  DOM.saveInputsButton =
    getElement("saveInputsButton");

  DOM.saveResultsProjectButton =
    getElement("saveResultsProjectButton");

  DOM.generatePdfButton =
    getElement("generatePdfButton");

  DOM.projectFileInput =
    getElement("projectFileInput");

  DOM.demandProfileType =
    getElement("demandProfileType");

  DOM.intrahourDemandProfileType =
    getElement(
      "intrahourDemandProfileType"
    );

  DOM.customDemandProfileContainer =
    getElement(
      "customDemandProfileContainer"
    );

  DOM.customDemandProfile =
    getElement("customDemandProfile");

  DOM.customProfileBars =
    getElement("customProfileBars");

  DOM.customProfileTotal =
    getElement("customProfileTotal");

  DOM.normalizeCustomProfileButton =
    getElement(
      "normalizeCustomProfileButton"
    );

  DOM.resetCustomProfileButton =
    getElement(
      "resetCustomProfileButton"
    );

  DOM.numberOfPeople =
    getElement("numberOfPeople");

  DOM.unitVolumeAt60CPerPersonDayL =
    getElement(
      "unitVolumeAt60CPerPersonDayL"
    );

  DOM.totalDailyDemandAt60CL =
    getElement(
      "totalDailyDemandAt60CL"
    );

  DOM.generatedDemandProfile =
    getElement(
      "generatedDemandProfile"
    );

  DOM.tankCount =
    getElement("tankCount");

  DOM.tank2Card =
    getElement("tank2Card");

  DOM.d1ExchangerType =
    getElement("d1ExchangerType");

  DOM.d2ExchangerType =
    getElement("d2ExchangerType");

  DOM.d1ImmersedConfig =
    getElement("d1ImmersedConfig");

  DOM.d2ImmersedConfig =
    getElement("d2ImmersedConfig");

  DOM.resultsGrid =
    getElement("generalResultsGrid");

  DOM.tankResultsTableBody =
    getElement("tankResultsTableBody");

  DOM.operatingSummaryTableBody =
    getElement("operatingSummaryTableBody");

  DOM.sanitaryAssessmentCard =
    getElement("sanitaryAssessmentCard");

  DOM.comfortAssessmentCard =
    getElement("comfortAssessmentCard");

  DOM.conclusionsContainer =
    getElement("conclusionsContainer");

}


/* ============================================================
 * UTILIDADES
 * ============================================================ */

/**
 * Lee un campo numérico.
 */
function readNumber(id) {
  const element =
    getElement(id);

  const value =
    Number(element.value);

  if (!Number.isFinite(value)) {
    throw new Error(
      `El campo "${getFieldLabel(element)}" debe contener un número válido.`
    );
  }

  return value;
}


/**
 * Obtiene el texto del label de un campo.
 */
function getFieldLabel(element) {
  const label =
    document.querySelector(
      `label[for="${element.id}"]`
    );

  return label
    ? label.textContent.trim()
    : element.id;
}


/**
 * Formatea un número para mostrarlo.
 */
function formatNumber(
  value,
  maximumFractionDigits = 2
) {
  if (!Number.isFinite(value)) {
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
 * Genera una fecha local en formato YYYY-MM-DD.
 */
function getLocalDateInputValue(
  date = new Date()
) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


/**
 * Formatea una fecha para presentación.
 */
function formatProjectDate(value) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(`${value}T00:00:00`);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleDateString(
    "es-ES"
  );
}


/* ============================================================
 * MENSAJES
 * ============================================================ */

/**
 * Muestra un mensaje general.
 */
function showGlobalMessage(
  message,
  type = "info"
) {
  DOM.globalMessage.hidden = false;

  DOM.globalMessage.textContent =
    message;

  DOM.globalMessage.className =
    "global-message";

  if (type !== "info") {
    DOM.globalMessage
      .classList
      .add(
        `global-message--${type}`
      );
  }

  DOM.globalMessage.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}


/**
 * Oculta el mensaje general.
 */
function hideGlobalMessage() {
  DOM.globalMessage.hidden = true;

  DOM.globalMessage.textContent = "";

  DOM.globalMessage.className =
    "global-message";
}


/**
 * Cambia el estado visible del cálculo.
 */
function setCalculationStatus(
  text,
  type = "neutral"
) {
  DOM.simulationStatus.textContent =
    text;

  DOM.simulationStatus.className =
    "calculation-status";

  if (type !== "neutral") {
    DOM.simulationStatus
      .classList
      .add(
        `calculation-status--${type}`
      );
  }
}


/* ============================================================
 * NAVEGACIÓN ENTRE PANTALLAS
 * ============================================================ */

const SCREEN_IDS = {
  project: "projectScreen",
  inputs: "inputsScreen",
  results: "resultsScreen"
};


/**
 * Muestra una pantalla.
 */
function showScreen(screenName) {
  if (!SCREEN_IDS[screenName]) {
    throw new Error(
      `Pantalla no válida: ${screenName}.`
    );
  }

  const screens = [
    DOM.projectScreen,
    DOM.inputsScreen,
    DOM.resultsScreen
  ];

  screens.forEach(
    screen => {
      const isActive =
        screen.dataset.screen ===
        screenName;

      screen.hidden =
        !isActive;

      screen.classList.toggle(
        "screen--active",
        isActive
      );
    }
  );

  ACSAppState.currentScreen =
    screenName;

  updateStepper(screenName);

  hideGlobalMessage();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  /*
   * El canvas debe redibujarse cuando la pantalla de resultados
   * ya está visible. Si se dibuja mientras está oculta, el ancho
   * disponible puede ser incorrecto.
   */
  if (
    screenName === "results" &&
    ACSAppState.hasCalculated
  ) {
    window.requestAnimationFrame(
      () => {
        renderActiveChart();
      }
    );
  }

  if (
    screenName === "inputs" &&
    ACSAppState.demandProfilePreview
  ) {
    window.requestAnimationFrame(
      () => {
        renderDemandProfileChart(
          ACSAppState.demandProfilePreview
        );
      }
    );
  }
}


/**
 * Actualiza el indicador de pasos.
 */
function updateStepper(
  activeScreen
) {
  const steps = [
    {
      name: "project",
      element:
        DOM.stepProjectButton,
      order: 1
    },
    {
      name: "inputs",
      element:
        DOM.stepInputsButton,
      order: 2
    },
    {
      name: "results",
      element:
        DOM.stepResultsButton,
      order: 3
    }
  ];

  const activeOrder =
    steps.find(
      step =>
        step.name ===
        activeScreen
    ).order;

  steps.forEach(
    step => {
      const isActive =
        step.name ===
        activeScreen;

      const isCompleted =
        step.order <
        activeOrder;

      step.element
        .classList
        .toggle(
          "stepper__item--active",
          isActive
        );

      step.element
        .classList
        .toggle(
          "stepper__item--completed",
          isCompleted
        );

      if (isActive) {
        step.element.setAttribute(
          "aria-current",
          "step"
        );
      } else {
        step.element.removeAttribute(
          "aria-current"
        );
      }
    }
  );
}


/* ============================================================
 * VALIDACIÓN DE FORMULARIOS
 * ============================================================ */

/**
 * Limpia los estados de error.
 */
function clearFormErrors(form) {
  form
    .querySelectorAll(
      '[aria-invalid="true"]'
    )
    .forEach(
      element => {
        element.removeAttribute(
          "aria-invalid"
        );
      }
    );

  form
    .querySelectorAll(
      ".form-field__error"
    )
    .forEach(
      element => {
        element.remove();
      }
    );
}


/**
 * Marca un campo con error.
 */
function markFieldInvalid(
  element,
  message
) {
  element.setAttribute(
    "aria-invalid",
    "true"
  );

  const field =
    element.closest(
      ".form-field"
    );

  if (!field) {
    return;
  }

  const existingError =
    field.querySelector(
      ".form-field__error"
    );

  if (existingError) {
    existingError.remove();
  }

  const errorElement =
    document.createElement("small");

  errorElement.className =
    "form-field__error";

  errorElement.textContent =
    message;

  field.appendChild(
    errorElement
  );
}


/**
 * Valida campos HTML obligatorios.
 */
function validateRequiredFields(
  form
) {
  clearFormErrors(form);

  const fields =
    form.querySelectorAll(
      "input, select, textarea"
    );

  let firstInvalid = null;

  fields.forEach(
    field => {
      if (
        field.disabled ||
        field.hidden ||
        field.closest("[hidden]")
      ) {
        return;
      }

      if (!field.checkValidity()) {
        markFieldInvalid(
          field,
          field.validationMessage
        );

        if (!firstInvalid) {
          firstInvalid = field;
        }
      }
    }
  );

  if (firstInvalid) {
    firstInvalid.focus();

    return false;
  }

  return true;
}


/* ============================================================
 * DATOS GENERALES DEL PROYECTO
 * ============================================================ */

/**
 * Lee los datos del proyecto.
 */
function readProjectData() {
  return {
    name:
      getElement(
        "projectName"
      ).value.trim(),

    client:
      getElement(
        "projectClient"
      ).value.trim(),

    designer:
      getElement(
        "projectDesigner"
      ).value.trim(),

    date:
      getElement(
        "projectDate"
      ).value,

    address:
      getElement(
        "projectAddress"
      ).value.trim(),

    postalCode:
      getElement(
        "projectPostalCode"
      ).value.trim(),

    city:
      getElement(
        "projectCity"
      ).value.trim()
  };
}


/**
 * Rellena el resumen de proyecto.
 */
function renderProjectSummary(
  projectData
) {
  getElement(
    "resultProjectName"
  ).textContent =
    projectData.name || "—";

  getElement(
    "resultProjectDesigner"
  ).textContent =
    projectData.designer || "—";

  getElement(
    "resultProjectDate"
  ).textContent =
    formatProjectDate(
      projectData.date
    );

  const locationParts = [
    projectData.address,
    projectData.postalCode,
    projectData.city
  ].filter(Boolean);

  getElement(
    "resultProjectLocation"
  ).textContent =
    locationParts.length > 0
      ? locationParts.join(", ")
      : "—";
}


/* ============================================================
 * PERFIL DE DEMANDA
 * ============================================================ */

const DEFAULT_CUSTOM_DEMAND_PROFILE = Object.freeze([
  1, 1, 1, 1, 1, 2,
  5, 8, 8, 5, 4, 4,
  4, 4, 4, 5, 6, 7,
  8, 7, 6, 4, 2, 2
]);

let customDemandProfileValues =
  [...DEFAULT_CUSTOM_DEMAND_PROFILE];


/**
 * Redondea un porcentaje horario a una cifra decimal.
 */
function roundProfileValue(value) {
  return Math.round(
    (value + Number.EPSILON) * 10
  ) / 10;
}


/**
 * Lee 24 valores desde el campo interno del perfil.
 */
function readCustomProfileSource() {
  const values =
    DOM.customDemandProfile
      .value
      .split(/[\s,;]+/)
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean)
      .map(Number);

  if (
    values.length !== 24 ||
    values.some(
      value =>
        !Number.isFinite(value) ||
        value < 0
    )
  ) {
    return [
      ...DEFAULT_CUSTOM_DEMAND_PROFILE
    ];
  }

  return values.map(
    value =>
      roundProfileValue(value)
  );
}


/**
 * Devuelve la suma actual del perfil.
 */
function getCustomProfileTotal() {
  return roundProfileValue(
    customDemandProfileValues
      .reduce(
        (sum, value) =>
          sum + Number(value || 0),
        0
      )
  );
}


/**
 * Sincroniza el editor visual con el textarea interno.
 *
 * El textarea se mantiene para que el resto de módulos
 * y el guardado de proyectos sigan funcionando igual.
 */
function syncCustomProfileSource(
  dispatchEvents = true
) {
  DOM.customDemandProfile.value =
    customDemandProfileValues
      .map(
        value =>
          roundProfileValue(value)
      )
      .join(", ");

  if (!dispatchEvents) {
    return;
  }

  DOM.customDemandProfile
    .dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );

  DOM.customDemandProfile
    .dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true
        }
      )
    );
}


/**
 * Actualiza el indicador de suma total.
 */
function updateCustomProfileTotalDisplay() {
  const total =
    getCustomProfileTotal();

  const isValid =
    Math.abs(total - 100) <= 0.01;

  DOM.customProfileTotal
    .textContent =
    `Total: ${formatNumber(total, 1)} %`;

  DOM.customProfileTotal
    .classList
    .toggle(
      "custom-profile-total--invalid",
      !isValid
    );

  DOM.customProfileTotal
    .setAttribute(
      "aria-label",
      isValid
        ? "El perfil suma correctamente 100 por ciento."
        : `El perfil suma ${formatNumber(total, 1)} por ciento y debe sumar 100.`
    );
}


/**
 * Actualiza un control horario concreto.
 */
function updateCustomProfileHourControls(
  hourIndex
) {
  const row =
    DOM.customProfileBars
      .querySelector(
        `[data-hour-index="${hourIndex}"]`
      );

  if (!row) {
    return;
  }

  const rangeInput =
    row.querySelector(
      'input[type="range"]'
    );

  const numberInput =
    row.querySelector(
      'input[type="number"]'
    );

  rangeInput.value =
    customDemandProfileValues[
      hourIndex
    ];

  numberInput.value =
    customDemandProfileValues[
      hourIndex
    ];
}


/**
 * Cambia el valor porcentual de una hora.
 */
function setCustomProfileHourValue(
  hourIndex,
  rawValue
) {
  const parsedValue =
    Number.parseFloat(rawValue);

  const safeValue =
    Number.isFinite(parsedValue)
      ? Math.min(
          100,
          Math.max(0, parsedValue)
        )
      : 0;

  customDemandProfileValues[
    hourIndex
  ] =
    roundProfileValue(safeValue);

  updateCustomProfileHourControls(
    hourIndex
  );

  updateCustomProfileTotalDisplay();

  syncCustomProfileSource();
}


/**
 * Crea un control visual para una hora.
 */
function createCustomProfileHourControl(
  hourIndex
) {
  const hour =
    String(hourIndex)
      .padStart(2, "0");

  const row =
    document.createElement("div");

  row.className =
    "custom-profile-hour";

  row.dataset.hourIndex =
    String(hourIndex);

  row.innerHTML =
    `
      <span class="custom-profile-hour__label">
        ${hour} h
      </span>

      <input
        type="range"
        min="0"
        max="100"
        step="0.5"
        value="${customDemandProfileValues[hourIndex]}"
        aria-label="Porcentaje de demanda a las ${hour}:00"
      >

      <label class="custom-profile-hour__value">
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value="${customDemandProfileValues[hourIndex]}"
          aria-label="Valor porcentual a las ${hour}:00"
        >

        <span>%</span>
      </label>
    `;

  const rangeInput =
    row.querySelector(
      'input[type="range"]'
    );

  const numberInput =
    row.querySelector(
      'input[type="number"]'
    );

  rangeInput.addEventListener(
    "input",
    event => {
      setCustomProfileHourValue(
        hourIndex,
        event.target.value
      );
    }
  );

  numberInput.addEventListener(
    "input",
    event => {
      setCustomProfileHourValue(
        hourIndex,
        event.target.value
      );
    }
  );

  return row;
}


/**
 * Renderiza los 24 controles horarios.
 */
function renderCustomDemandProfileEditor(
  dispatchEvents = true
) {
  DOM.customProfileBars.innerHTML =
    "";

  customDemandProfileValues
    .forEach(
      (
        _value,
        hourIndex
      ) => {
        DOM.customProfileBars
          .appendChild(
            createCustomProfileHourControl(
              hourIndex
            )
          );
      }
    );

  updateCustomProfileTotalDisplay();

  syncCustomProfileSource(
    dispatchEvents
  );
}


/**
 * Normaliza proporcionalmente el perfil a 100 %.
 */
function normalizeCustomDemandProfile() {
  const total =
    getCustomProfileTotal();

  if (total <= 0) {
    customDemandProfileValues =
      [
        ...DEFAULT_CUSTOM_DEMAND_PROFILE
      ];
  } else {
    customDemandProfileValues =
      customDemandProfileValues
        .map(
          value =>
            roundProfileValue(
              value / total * 100
            )
        );

    const normalizedTotal =
      getCustomProfileTotal();

    const difference =
      roundProfileValue(
        100 - normalizedTotal
      );

    const largestValue =
      Math.max(
        ...customDemandProfileValues
      );

    const largestIndex =
      customDemandProfileValues
        .indexOf(largestValue);

    customDemandProfileValues[
      largestIndex
    ] =
      roundProfileValue(
        Math.max(
          0,
          customDemandProfileValues[
            largestIndex
          ] + difference
        )
      );
  }

  renderCustomDemandProfileEditor();
}


/**
 * Restablece el perfil horario de ejemplo.
 */
function resetCustomDemandProfile() {
  customDemandProfileValues =
    [
      ...DEFAULT_CUSTOM_DEMAND_PROFILE
    ];

  renderCustomDemandProfileEditor();
}


/**
 * Recarga el editor desde el textarea interno.
 *
 * Es útil al abrir un proyecto guardado o cuando otro módulo
 * modifica el perfil mediante código.
 */
function refreshCustomDemandProfileEditorFromSource() {
  customDemandProfileValues =
    readCustomProfileSource();

  renderCustomDemandProfileEditor(
    false
  );

  updateDemandPreview();
}


/**
 * Convierte el perfil personalizado en números.
 */
function parseCustomDemandProfile() {
  const values =
    readCustomProfileSource();

  if (values.length !== 24) {
    throw new Error(
      "El perfil personalizado debe contener exactamente 24 porcentajes."
    );
  }

  values.forEach(
    (
      value,
      index
    ) => {
      if (
        !Number.isFinite(value) ||
        value < 0
      ) {
        throw new Error(
          `El porcentaje de la hora ${index + 1} no es válido.`
        );
      }
    }
  );

  const total =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  if (
    Math.abs(total - 100) >
    0.01
  ) {
    throw new Error(
      `El perfil personalizado debe sumar 100 %. Actualmente suma ${formatNumber(total, 3)} %.`
    );
  }

  return values;
}


/**
 * Construye la definición de demanda.
 */
function buildDemandProfileDefinition() {
  const profileType =
    DOM.demandProfileType.value;

  const numberOfPeople =
    readNumber(
      "numberOfPeople"
    );

  const unitVolumeAt60CPerPersonDayL =
    readNumber(
      "unitVolumeAt60CPerPersonDayL"
    );

  if (numberOfPeople <= 0) {
    throw new Error(
      "El número de personas debe ser mayor que cero."
    );
  }

  if (
    unitVolumeAt60CPerPersonDayL <=
    0
  ) {
    throw new Error(
      "El volumen unitario debe ser mayor que cero."
    );
  }

  return {
    profileType,

    numberOfPeople,

    unitVolumeAt60CPerPersonDayL,

    customHourlyPercentages:
      profileType === "custom"
        ? parseCustomDemandProfile()
        : undefined
  };
}


/**
 * Obtiene la función de perfiles del motor.
 */
function getDemandProfileCreator() {
  if (
    window.ACSBlock1 &&
    typeof window
      .ACSBlock1
      .createDailyDemandProfileAt60C ===
      "function"
  ) {
    return window
      .ACSBlock1
      .createDailyDemandProfileAt60C;
  }

  if (
    window.ACS &&
    typeof window
      .ACS
      .createDailyDemandProfileAt60C ===
      "function"
  ) {
    return window
      .ACS
      .createDailyDemandProfileAt60C;
  }

  throw new Error(
    "El motor no contiene la función de generación de perfiles de demanda."
  );
}


/**
 * Actualiza la vista previa de demanda.
 */
function updateDemandPreview() {
  try {
    const createProfile =
      getDemandProfileCreator();

    const definition =
      buildDemandProfileDefinition();

    const generatedProfile =
      createProfile(
        definition
      );

    DOM.totalDailyDemandAt60CL
      .value =
      formatNumber(
        generatedProfile
          .totalDailyDemandAt60CL,
        2
      );

    DOM.generatedDemandProfile
      .value =
      generatedProfile
        .hourlyDemandAt60CL
        .map(
          value =>
            formatNumber(
              value,
              2
            )
        )
        .join(", ");

    DOM.generatedDemandProfile
      .removeAttribute(
        "aria-invalid"
      );

    const previewData = {
      hours:
        Array.from(
          { length: 24 },
          (
            _value,
            hourIndex
          ) => ({
            hourIndex,
            label:
              `${String(
                hourIndex
              ).padStart(
                2,
                "0"
              )}:00`
          })
        ),

      hourlyDemandAt60CL:
        generatedProfile
          .hourlyDemandAt60CL
          .map(Number),

      referenceTemperatureC:
        60,

      networkTemperatureC:
        Number(
          getElement(
            "networkTemperatureC"
          ).value
        )
    };

    ACSAppState
      .demandProfilePreview =
      previewData;

    renderDemandProfileChart(
      previewData
    );

    return generatedProfile;

  } catch (error) {
    DOM.totalDailyDemandAt60CL
      .value = "";

    DOM.generatedDemandProfile
      .value =
      error.message;

    DOM.generatedDemandProfile
      .setAttribute(
        "aria-invalid",
        "true"
      );

    ACSAppState
      .demandProfilePreview =
      null;

    if (
      window.ACSCharts &&
      typeof window
        .ACSCharts
        .clearDemandProfile ===
        "function"
    ) {
      window
        .ACSCharts
        .clearDemandProfile();
    }

    return null;
  }
}


/**
 * Dibuja la vista previa del perfil horario de demanda.
 */
function renderDemandProfileChart(
  previewData =
    ACSAppState
      .demandProfilePreview
) {
  if (
    !previewData ||
    !window.ACSCharts ||
    typeof window
      .ACSCharts
      .renderDemandProfile !==
      "function"
  ) {
    return;
  }

  try {
    window
      .ACSCharts
      .renderDemandProfile(
        previewData
      );
  } catch (error) {
    console.error(
      "No se ha podido dibujar el perfil horario de demanda.",
      error
    );
  }
}


/**
 * Muestra u oculta el perfil personalizado.
 */
function updateCustomProfileVisibility() {
  const isCustom =
    DOM.demandProfileType
      .value === "custom";

  DOM.customDemandProfileContainer
    .hidden =
    !isCustom;

  DOM.customDemandProfile.required =
    isCustom;

  updateDemandPreview();
}


/* ============================================================
 * DEPÓSITOS E INTERCAMBIADORES
 * ============================================================ */

/**
 * Devuelve los IDs de caracterización térmica de un intercambiador.
 */
function getImmersedFieldIds(
  tankNumber
) {
  const prefix =
    `d${tankNumber}`;

  return [
    `${prefix}NominalPrimaryInletTemperatureC`,
    `${prefix}NominalPrimaryOutletTemperatureC`,
    `${prefix}NominalSecondaryInletTemperatureC`,
    `${prefix}NominalSecondaryOutletTemperatureC`,
    `${prefix}ActualPrimaryInletTemperatureC`,
    `${prefix}ActualPrimaryOutletTemperatureC`
  ];
}


/**
 * Activa o desactiva la caracterización térmica del intercambiador.
 */
function setImmersedFieldsState(
  tankNumber,
  enabled
) {
  const container =
    tankNumber === 1
      ? DOM.d1ImmersedConfig
      : DOM.d2ImmersedConfig;

  if (!container) {
    return;
  }

  container.hidden =
    !enabled;

  getImmersedFieldIds(
    tankNumber
  ).forEach(
    id => {
      const field =
        getElement(id);

      field.disabled =
        !enabled;

      field.required =
        enabled;
    }
  );
}


/**
 * Actualiza la visibilidad de los campos según la disponibilidad
 * del depósito. Tanto placas como serpentines se caracterizan.
 */
function updateExchangerVisibility(
  tankNumber
) {
  const hasTwoTanks =
    Number(
      DOM.tankCount.value
    ) === 2;

  const tankEnabled =
    tankNumber === 1 ||
    hasTwoTanks;

  setImmersedFieldsState(
    tankNumber,
    tankEnabled
  );
}


/**
 * Actualiza ambos depósitos.
 */
function updateAllExchangerVisibility() {
  updateExchangerVisibility(1);
  updateExchangerVisibility(2);
}


/**
 * Muestra u oculta D2.
 */
function updateTank2Visibility() {
  const hasTwoTanks =
    Number(
      DOM.tankCount.value
    ) === 2;

  DOM.tank2Card.hidden =
    !hasTwoTanks;

  const d2Fields = [
    getElement("d2VolumeL"),
    getElement("d2ExchangerPowerKW"),
    DOM.d2ExchangerType
  ];

  d2Fields.forEach(
    field => {
      field.disabled =
        !hasTwoTanks;

      field.required =
        hasTwoTanks;
    }
  );

  updateAllExchangerVisibility();
}


/**
 * Lee la configuración de un depósito.
 */
function buildTankConfig(
  tankNumber
) {
  const prefix =
    `d${tankNumber}`;

  const exchangerType =
    getElement(
      `${prefix}ExchangerType`
    ).value;

  const tank = {
    volumeL:
      readNumber(
        `${prefix}VolumeL`
      ),

    exchangerType,

    exchangerPowerKW:
      readNumber(
        `${prefix}ExchangerPowerKW`
      )
  };

  tank.nominalPrimaryInletTemperatureC =
    readNumber(
      `${prefix}NominalPrimaryInletTemperatureC`
    );

  tank.nominalPrimaryOutletTemperatureC =
    readNumber(
      `${prefix}NominalPrimaryOutletTemperatureC`
    );

  tank.nominalSecondaryInletTemperatureC =
    readNumber(
      `${prefix}NominalSecondaryInletTemperatureC`
    );

  tank.nominalSecondaryOutletTemperatureC =
    readNumber(
      `${prefix}NominalSecondaryOutletTemperatureC`
    );

  tank.actualPrimaryInletTemperatureC =
    readNumber(
      `${prefix}ActualPrimaryInletTemperatureC`
    );

  tank.actualPrimaryOutletTemperatureC =
    readNumber(
      `${prefix}ActualPrimaryOutletTemperatureC`
    );

  return tank;
}


/* ============================================================
 * CONFIGURACIÓN DE SIMULACIÓN
 * ============================================================ */

/**
 * Construye la configuración que recibe el motor.
 */
function buildSimulationConfig() {
  const tankCount =
    readNumber("tankCount");

  const tanks = [
    buildTankConfig(1)
  ];

  if (tankCount === 2) {
    tanks.push(
      buildTankConfig(2)
    );
  }

  const config = {
    tankCount,

    tanks,

    storageTemperatureC:
      readNumber(
        "storageTemperatureC"
      ),

    useTemperatureC:
      readNumber(
        "useTemperatureC"
      ),

    networkTemperatureC:
      readNumber(
        "networkTemperatureC"
      ),

    demandProfile:
      buildDemandProfileDefinition(),

    intrahourDemandProfileType:
      DOM
        .intrahourDemandProfileType
        .value,

    generatorPowerKW:
      readNumber(
        "generatorPowerKW"
      ),

    generatorRampMinutes:
      readNumber(
        "generatorRampMinutes"
      ),

    minimumGeneratorStartIntervalMinutes:
      readNumber(
        "minimumGeneratorStartIntervalMinutes"
      ),

    hasSufficientGeneratorInertia:
      getElement(
        "hasSufficientGeneratorInertia"
      ).checked,

    generatorMinimumPowerKW:
      readNumber(
        "generatorMinimumPowerKW"
      ),

    maximumBelowMinimumPowerMinutes:
      readNumber(
        "maximumBelowMinimumPowerMinutes"
      ),

    startThresholdPercent:
      readNumber(
        "startThresholdPercent"
      ),

    lossPercent:
      readNumber(
        "lossPercent"
      ),

    sanitaryCheck:
      getElement(
        "sanitaryCheck"
      ).checked
  };

  validateSimulationConfigBeforeEngine(
    config
  );

  return config;
}


/**
 * Devuelve los tipos de perfil intrahorario admitidos.
 */
function getAllowedIntrahourDemandProfiles() {
  return [
    "uniform",
    "front-loaded-30",
    "centered-30",
    "back-loaded-30",
    "front-loaded-15",
    "centered-15",
    "double-peak"
  ];
}


/**
 * Validaciones básicas previas al motor.
 *
 * El motor volverá a validar la configuración.
 */
function validateSimulationConfigBeforeEngine(
  config
) {
  if (
    config.storageTemperatureC <=
    config.useTemperatureC
  ) {
    throw new Error(
      "La temperatura de acumulación debe ser mayor que la temperatura de uso."
    );
  }

  if (
    config.useTemperatureC <=
    config.networkTemperatureC
  ) {
    throw new Error(
      "La temperatura de uso debe ser mayor que la temperatura de red."
    );
  }

  if (
    config.lossPercent < 0 ||
    config.lossPercent > 40
  ) {
    throw new Error(
      "El porcentaje de pérdidas debe estar comprendido entre 0 y 40 %."
    );
  }

  if (
    config.generatorPowerKW < 0
  ) {
    throw new Error(
      "La potencia del generador no puede ser negativa."
    );
  }

  if (
    config.generatorRampMinutes < 0
  ) {
    throw new Error(
      "El tiempo de rampa del generador no puede ser negativo."
    );
  }

  if (
    config.minimumGeneratorStartIntervalMinutes < 0
  ) {
    throw new Error(
      "El intervalo mínimo entre arranques no puede ser negativo."
    );
  }

  if (
    config.generatorMinimumPowerKW < 0 ||
    config.generatorMinimumPowerKW >
      config.generatorPowerKW
  ) {
    throw new Error(
      "La potencia mínima debe estar entre 0 y la potencia nominal del generador."
    );
  }

  if (
    config.maximumBelowMinimumPowerMinutes < 0
  ) {
    throw new Error(
      "El tiempo máximo bajo potencia mínima no puede ser negativo."
    );
  }

  if (
    !getAllowedIntrahourDemandProfiles()
      .includes(
        config
          .intrahourDemandProfileType
      )
  ) {
    throw new Error(
      "El perfil intrahorario seleccionado no es válido."
    );
  }

  config.tanks.forEach(
    (
      tank,
      index
    ) => {
      if (tank.volumeL <= 0) {
        throw new Error(
          `El volumen del depósito D${index + 1} debe ser mayor que cero.`
        );
      }

      if (
        tank.exchangerPowerKW < 0
      ) {
        throw new Error(
          `La potencia del intercambiador D${index + 1} no puede ser negativa.`
        );
      }

      if (
        tank.exchangerType !== "plate" &&
        tank.exchangerType !== "immersed"
      ) {
        throw new Error(
          `El tipo de intercambiador D${index + 1} no es válido.`
        );
      }

      {
        if (
          tank.nominalPrimaryInletTemperatureC <=
          tank.nominalPrimaryOutletTemperatureC
        ) {
          throw new Error(
            `En D${index + 1}, la ida nominal del primario debe ser mayor que el retorno nominal.`
          );
        }

        if (
          tank.nominalSecondaryOutletTemperatureC <=
          tank.nominalSecondaryInletTemperatureC
        ) {
          throw new Error(
            `En D${index + 1}, la salida nominal del secundario debe ser mayor que la entrada nominal.`
          );
        }

        if (
          tank.actualPrimaryInletTemperatureC <=
          tank.actualPrimaryOutletTemperatureC
        ) {
          throw new Error(
            `En D${index + 1}, la ida real del primario debe ser mayor que el retorno real.`
          );
        }

        const nominalPrimaryMean =
          (
            tank.nominalPrimaryInletTemperatureC +
            tank.nominalPrimaryOutletTemperatureC
          ) / 2;

        const nominalSecondaryMean =
          (
            tank.nominalSecondaryInletTemperatureC +
            tank.nominalSecondaryOutletTemperatureC
          ) / 2;

        if (
          nominalPrimaryMean <=
          nominalSecondaryMean
        ) {
          throw new Error(
            `En D${index + 1}, la temperatura media nominal del primario debe ser mayor que la del secundario.`
          );
        }
      }
    }
  );
}


/* ============================================================
 * EJECUCIÓN DEL MOTOR
 * ============================================================ */

/**
 * Ejecuta la simulación.
 */
function runSimulation() {
  if (
    !window.ACSSimulationEngine ||
    typeof window
      .ACSSimulationEngine
      .run !== "function"
  ) {
    throw new Error(
      "No se ha cargado correctamente acs-simulation-engine.js."
    );
  }

  const config =
    buildSimulationConfig();

  ACSAppState.inputConfig =
    config;

  /*
   * Se incluyen los resultados por minuto porque:
   *
   * - el bloque 7 calculará indicadores hidráulicos;
   * - la validación completa del motor los necesita;
   * - las valoraciones sanitarias trabajan por minuto.
   */
  const result =
    window
      .ACSSimulationEngine
      .run(
        config,
        {
          includeMinuteResults: true
        }
      );

  return result;
}


/**
 * Crea el análisis del bloque 7 cuando esté disponible.
 */
function createBlock7Analysis(
  engineResult
) {
  if (
    window.ACSBlock7 &&
    typeof window
      .ACSBlock7
      .createAnalysis ===
      "function"
  ) {
    return window
      .ACSBlock7
      .createAnalysis({
        project:
          ACSAppState.projectData,

        engineResult
      });
  }

  return null;
}


/* ============================================================
 * RESULTADOS TEMPORALES
 * ============================================================ */

/**
 * Limpia los resultados visibles.
 */
function clearRenderedResults() {
  DOM.resultsGrid.innerHTML = "";

  DOM.tankResultsTableBody
    .innerHTML =
    `
      <tr>
        <td colspan="8">
          Sin resultados disponibles.
        </td>
      </tr>
    `;

  resetAssessmentCard(
    DOM.sanitaryAssessmentCard,
    "Comprobación sanitaria"
  );

  resetAssessmentCard(
    DOM.comfortAssessmentCard,
    "Confort"
  );

  DOM.operatingSummaryTableBody
    .innerHTML =
    `
      <tr>
        <td colspan="9">
          Sin resultados disponibles.
        </td>
      </tr>
    `;

  DOM.conclusionsContainer
    .innerHTML =
    "<p>Sin conclusiones disponibles.</p>";
}


/**
 * Restablece una tarjeta de valoración.
 */
function resetAssessmentCard(
  element,
  title
) {
  element.className =
    "assessment-card";

  element.innerHTML =
    `
      <h4>${title}</h4>

      <p class="assessment-card__status">
        Sin evaluar
      </p>

      <p class="assessment-card__message">
        Ejecuta la simulación para obtener
        la valoración.
      </p>
    `;
}


/**
 * Rellena la tabla horaria de operación de las últimas 24 horas.
 *
 * Los resultados horarios aportan los balances energéticos y los
 * minutos del periodo de análisis permiten localizar el primer
 * arranque del generador dentro de cada hora.
 */
function renderOperatingSummary(
  engineResult
) {
  const analysisResults =
    engineResult
      ?.simulation
      ?.results
      ?.analysis ||
    engineResult
      ?.results
      ?.analysis ||
    {};

  const hourlyResults =
    analysisResults.hourly;

  const minuteResults =
    Array.isArray(
      analysisResults.minute
    )
      ? analysisResults.minute
      : [];

  if (
    !Array.isArray(hourlyResults) ||
    hourlyResults.length === 0
  ) {
    DOM.operatingSummaryTableBody
      .innerHTML =
      `
        <tr>
          <td colspan="9">
            Sin resultados horarios disponibles.
          </td>
        </tr>
      `;

    return;
  }

  const rows =
    hourlyResults
      .slice(0, 24)
      .map(
        (
          hour,
          displayIndex
        ) => {
          const energy =
            hour.energy || {};

          const generator =
            hour.generator || {};

          const demandKWh =
            Number.isFinite(
              energy.requestedDemandEnergyKWh
            )
              ? energy.requestedDemandEnergyKWh
              : null;

          const lossesKWh =
            Number.isFinite(
              energy.recirculationLossKWh
            )
              ? energy.recirculationLossKWh
              : null;

          const deliveredTotalKWh =
            Number.isFinite(
              energy.coveredDemandEnergyKWh
            ) &&
            Number.isFinite(
              energy.recirculationLossKWh
            )
              ? (
                  energy.coveredDemandEnergyKWh +
                  energy.recirculationLossKWh
                )
              : null;

          const generatedKWh =
            Number.isFinite(
              energy.generatedEnergyKWh
            )
              ? energy.generatedEnergyKWh
              : null;

          const starts =
            Number.isFinite(
              generator.starts
            )
              ? generator.starts
              : null;

          const minutesInHour =
            minuteResults.filter(
              minute =>
                minute.hourIndex ===
                hour.hourIndex
            );

          const calculatedRunningMinutes =
            minutesInHour.filter(
              minute =>
                minute
                  .generation
                  ?.generatorRunning === true ||
                minute
                  .generatorState
                  ?.running === true
            ).length;

          const runningMinutes =
            minutesInHour.length > 0
              ? calculatedRunningMinutes
              : (
                  Number.isFinite(
                    generator.runningMinutes
                  )
                    ? generator.runningMinutes
                    : (
                        Number.isFinite(
                          generator.runningHours
                        )
                          ? generator.runningHours * 60
                          : 0
                      )
                );

          const averageMinutesPerStart =
            Number.isFinite(starts) &&
            starts > 0 &&
            Number.isFinite(runningMinutes)
              ? runningMinutes / starts
              : null;

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
            String(
              displayIndex
            ).padStart(2, "0");

          const endHour =
            String(
              (displayIndex + 1) % 24
            ).padStart(2, "0");

          const firstStartTime =
            firstStart
              ? `${startHour}:${String(
                  firstStart.minuteWithinHour
                ).padStart(2, "0")}`
              : "—";

          return `
            <tr>
              <td>
                ${startHour}:00–${endHour}:00
              </td>

              <td>
                ${
                  demandKWh === null
                    ? "—"
                    : `${formatNumber(demandKWh, 2)} kWh`
                }
              </td>

              <td>
                ${
                  lossesKWh === null
                    ? "—"
                    : `${formatNumber(lossesKWh, 2)} kWh`
                }
              </td>

              <td>
                ${
                  deliveredTotalKWh === null
                    ? "—"
                    : `${formatNumber(deliveredTotalKWh, 2)} kWh`
                }
              </td>

              <td>
                ${
                  generatedKWh === null
                    ? "—"
                    : `${formatNumber(generatedKWh, 2)} kWh`
                }
              </td>

              <td>
                ${
                  starts === null
                    ? "—"
                    : formatNumber(starts, 0)
                }
              </td>

              <td>
                ${firstStartTime}
              </td>

              <td>
                ${
                  runningMinutes === null
                    ? "—"
                    : `${formatNumber(runningMinutes, 0)} min`
                }
              </td>

              <td>
                ${
                  averageMinutesPerStart === null
                    ? "—"
                    : `${formatNumber(averageMinutesPerStart, 1)} min/arranque`
                }
              </td>
            </tr>
          `;
        }
      )
      .join("");

  DOM.operatingSummaryTableBody
    .innerHTML =
    rows;
}


/**
 * Muestra un resultado básico mientras Block 7 no existe.
 *
 * Esta función será sustituida por el renderizado final
 * cuando creemos block7-analysis.js.
 */
function renderTemporaryEngineResult(
  engineResult
) {
  const simulation =
    engineResult.simulation;

  const summary =
    engineResult.summary;

  renderOperatingSummary(
    engineResult
  );

  const cards = [
    {
      label: "Energía generada",
      value:
        `${formatNumber(
          summary.energy.generatedKWh,
          2
        )} kWh`,
      description:
        "Energía absorbida durante las últimas 24 horas."
    },
    {
      label: "Demanda cubierta",
      value:
        `${formatNumber(
          summary.energy.suppliedKWh,
          2
        )} kWh`,
      description:
        "Energía útil entregada."
    },
    {
      label: "Déficit energético",
      value:
        `${formatNumber(
          summary.energy.uncoveredKWh,
          2
        )} kWh`,
      description:
        "Demanda no cubierta."
    },
    {
      label: "Pérdidas",
      value:
        `${formatNumber(
          summary.energy.lossesKWh,
          2
        )} kWh`,
      description:
        `${formatNumber(
          summary
            .energy
            .lossesPercentOfDemand,
          2
        )} % de la demanda.`
    },
    {
      label: "Cobertura",
      value:
        `${formatNumber(
          summary
            .comfort
            .coveragePercent,
          2
        )} %`,
      description:
        "Cobertura energética de la demanda."
    },
    {
      label: "Funcionamiento generador",
      value:
        `${formatNumber(
          summary
            .generator
            .runningHours,
          2
        )} h`,
      description:
        `${formatNumber(
          summary
            .generator
            .starts,
          0
        )} arranques.`
    }
  ];

  DOM.resultsGrid.innerHTML =
    cards
      .map(
        card =>
          `
            <article class="result-card">
              <div class="result-card__label">
                ${card.label}
              </div>

              <div class="result-card__value">
                ${card.value}
              </div>

              <p class="result-card__description">
                ${card.description}
              </p>
            </article>
          `
      )
      .join("");

  const tankRows =
    simulation
      .results
      .analysis
      .totals
      .tanks
      .map(
        (
          tank,
          index
        ) => {
          const tankConfig =
            simulation
              .config
              .tanks[index];

          const exchanger =
            tank.exchanger || {};

          const averageEffectivePowerKW =
            Number.isFinite(
              exchanger.averageEffectivePowerKW
            )
              ? exchanger.averageEffectivePowerKW
              : tankConfig.exchangerPowerKW;

          return `
            <tr>
              <td>
                ${tank.tankId}
                <br>
                <small>
                  ${
                    tankConfig.exchangerType === "immersed"
                      ? "Serpentín sumergido"
                      : "Intercambiador de placas"
                  }
                </small>
              </td>

              <td>
                ${formatNumber(
                  tankConfig.volumeL,
                  0
                )} L
              </td>

              <td>
                ${formatNumber(
                  tankConfig
                    .exchangerPowerKW,
                  2
                )} kW
              </td>

              <td>
                ${formatNumber(
                  averageEffectivePowerKW,
                  2
                )} kW
              </td>

              <td>—</td>
              <td>—</td>

              <td>
                ${formatNumber(
                  tank.minimumLoadPercent,
                  2
                )} %
              </td>

              <td>
                ${formatNumber(
                  tank
                    .effectiveGenerationMinutes /
                    60,
                  2
                )} h
              </td>
            </tr>
          `;
        }
      )
      .join("");

  DOM.tankResultsTableBody
    .innerHTML =
    tankRows;

  DOM.conclusionsContainer
    .innerHTML =
    `
      <p>
        La simulación se ha ejecutado correctamente.
        Las valoraciones, tiempos de calentamiento,
        gráficas y conclusiones se añadirán al conectar
        el archivo <strong>block7-analysis.js</strong>.
      </p>
    `;
}


/* ============================================================
 * EVENTOS DE FORMULARIO
 * ============================================================ */

/**
 * Avanza desde proyecto a datos técnicos.
 */
function handleProjectSubmit(event) {
  event.preventDefault();

  hideGlobalMessage();

  if (
    !validateRequiredFields(
      DOM.projectForm
    )
  ) {
    showGlobalMessage(
      "Revisa los datos generales del proyecto.",
      "error"
    );

    return;
  }

  ACSAppState.projectData =
    readProjectData();

  renderProjectSummary(
    ACSAppState.projectData
  );

  showScreen("inputs");
}


/**
 * Ejecuta la simulación desde el formulario técnico.
 */
function handleSimulationSubmit(
  event
) {
  event.preventDefault();

  hideGlobalMessage();

  if (
    !validateRequiredFields(
      DOM.simulationForm
    )
  ) {
    showGlobalMessage(
      "Revisa los datos técnicos de la instalación.",
      "error"
    );

    return;
  }

  try {
    DOM.calculateButton.disabled =
      true;

    setCalculationStatus(
      "Calculando",
      "running"
    );

    const engineResult =
      runSimulation();

    ACSAppState.simulationResult =
      engineResult;

    ACSAppState.analysisResult =
      createBlock7Analysis(
        engineResult
      );

    ACSAppState.hasCalculated =
      true;

    ACSAppState.currentChartView =
      "load";

    DOM.stepResultsButton.disabled =
      false;

    renderProjectSummary(
      ACSAppState.projectData
    );

    if (
      ACSAppState.analysisResult &&
      typeof window
        .ACSAppRenderAnalysis ===
        "function"
    ) {
      window.ACSAppRenderAnalysis(
        ACSAppState.analysisResult
      );
    } else {
      renderTemporaryEngineResult(
        engineResult
      );
    }

    renderOperatingSummary(
      engineResult
    );

    setCalculationStatus(
      "Cálculo completado",
      "success"
    );

    showScreen("results");

    showGlobalMessage(
      "Simulación completada correctamente. Los resultados corresponden a las últimas 24 horas.",
      "success"
    );

  } catch (error) {
    setCalculationStatus(
      "Error de cálculo",
      "error"
    );

    showGlobalMessage(
      getReadableErrorMessage(
        error
      ),
      "error"
    );

    console.error(error);

  } finally {
    DOM.calculateButton.disabled =
      false;
  }
}


/**
 * Convierte un error del motor en texto legible.
 */
function getReadableErrorMessage(
  error
) {
  if (!error) {
    return "Se ha producido un error desconocido.";
  }

  if (
    error.details &&
    typeof error.details ===
      "object"
  ) {
    return `${error.message}\n\n${JSON.stringify(
      error.details,
      null,
      2
    )}`;
  }

  return error.message ||
    String(error);
}


/* ============================================================
 * NUEVO PROYECTO
 * ============================================================ */

/**
 * Restablece toda la aplicación.
 */
function createNewProject() {
  const hasData =
    Boolean(
      getElement(
        "projectName"
      ).value.trim()
    ) ||
    ACSAppState.hasCalculated;

  if (hasData) {
    const confirmed =
      window.confirm(
        "Se perderán los datos no guardados. ¿Quieres crear un proyecto nuevo?"
      );

    if (!confirmed) {
      return;
    }
  }

  DOM.projectForm.reset();

  DOM.simulationForm.reset();

  getElement(
    "projectDate"
  ).value =
    getLocalDateInputValue();

  ACSAppState.currentScreen =
    "project";

  ACSAppState.projectData =
    null;

  ACSAppState.inputConfig =
    null;

  ACSAppState.simulationResult =
    null;

  ACSAppState.analysisResult =
    null;

  ACSAppState.demandProfilePreview =
    null;

  ACSAppState.hasCalculated =
    false;

  ACSAppState.currentChartView =
    "load";

  DOM.stepResultsButton.disabled =
    true;

  clearRenderedResults();

  setCalculationStatus(
    "Sin calcular"
  );

  customDemandProfileValues =
    [
      ...DEFAULT_CUSTOM_DEMAND_PROFILE
    ];

  renderCustomDemandProfileEditor(
    false
  );

  updateTank2Visibility();

  updateAllExchangerVisibility();

  updateCustomProfileVisibility();

  showScreen("project");

  showGlobalMessage(
    "Se ha creado un proyecto nuevo.",
    "success"
  );
}


/* ============================================================
 * ABRIR, GUARDAR E INFORME
 * ============================================================ */

/**
 * Solicita guardar el proyecto.
 */
function requestSaveProject() {
  if (
    window.ACSProjectStorage &&
    typeof window
      .ACSProjectStorage
      .saveCurrentProject ===
      "function"
  ) {
    window
      .ACSProjectStorage
      .saveCurrentProject(
        getSerializableAppState()
      );

    return;
  }

  showGlobalMessage(
    "La función de guardado estará disponible al implementar project-storage.js.",
    "warning"
  );
}


/**
 * Abre el selector de archivos.
 */
function requestOpenProject() {
  if (
    window.ACSProjectStorage &&
    typeof window
      .ACSProjectStorage
      .openProjectFile ===
      "function"
  ) {
    DOM.projectFileInput.click();

    return;
  }

  showGlobalMessage(
    "La función de apertura estará disponible al implementar project-storage.js.",
    "warning"
  );
}


/**
 * Solicita el informe PDF.
 */
function requestGeneratePdf() {
  if (!ACSAppState.hasCalculated) {
    showGlobalMessage(
      "Primero debes ejecutar una simulación.",
      "warning"
    );

    return;
  }

  if (
    window.ACSReport &&
    typeof window
      .ACSReport
      .generatePdf ===
      "function"
  ) {
    window
      .ACSReport
      .generatePdf({
        project:
          ACSAppState.projectData,

        inputs:
          ACSAppState.inputConfig,

        simulation:
          ACSAppState
            .simulationResult,

        analysis:
          ACSAppState
            .analysisResult,

        demandProfile:
          ACSAppState
            .demandProfilePreview
      });

    return;
  }

  showGlobalMessage(
    "La generación del informe estará disponible al implementar report.js.",
    "warning"
  );
}


/**
 * Devuelve el estado que guardará project-storage.js.
 */
function getSerializableAppState() {
  /*
   * Se leen siempre los formularios en el momento de guardar.
   * Así no se reutiliza una configuración anterior si el usuario
   * ha modificado datos después del último cálculo.
   */
  const currentProject =
    readProjectData();

  const currentInputs =
    buildSimulationConfig();

  ACSAppState.projectData =
    currentProject;

  ACSAppState.inputConfig =
    currentInputs;

  return {
    version: "1.3.0",

    project:
      currentProject,

    inputs:
      currentInputs,

    demandProfilePreview:
      ACSAppState.demandProfilePreview ||
      null,

    calculated:
      ACSAppState.hasCalculated,

    savedAt:
      new Date().toISOString()
  };
}


/* ============================================================
 * GRÁFICAS
 * ============================================================ */

/**
 * Dibuja simultáneamente las tres gráficas de resultados.
 */
function renderAllCharts() {
  const chartData =
    ACSAppState
      .analysisResult
      ?.charts || null;

  if (
    !chartData ||
    !window.ACSCharts ||
    typeof window.ACSCharts.renderAll !== "function"
  ) {
    return;
  }

  try {
    window
      .ACSCharts
      .renderAll(
        chartData
      );
  } catch (error) {
    console.error(
      "No se han podido dibujar las gráficas.",
      error
    );

    showGlobalMessage(
      error.message ||
        "No se han podido dibujar las gráficas de resultados.",
      "error"
    );
  }
}


/**
 * Alias mantenido para el flujo de navegación.
 */
function renderActiveChart() {
  renderAllCharts();
}


/* ============================================================
 * REGISTRO DE EVENTOS
 * ============================================================ */

function registerEventListeners() {
  DOM.projectForm
    .addEventListener(
      "submit",
      handleProjectSubmit
    );

  DOM.simulationForm
    .addEventListener(
      "submit",
      handleSimulationSubmit
    );

  DOM.backToProjectButton
    .addEventListener(
      "click",
      () =>
        showScreen("project")
    );

  DOM.backToInputsButton
    .addEventListener(
      "click",
      () =>
        showScreen("inputs")
    );

  DOM.stepProjectButton
    .addEventListener(
      "click",
      () =>
        showScreen("project")
    );

  DOM.stepInputsButton
    .addEventListener(
      "click",
      () => {
        if (
          !ACSAppState.projectData
        ) {
          showGlobalMessage(
            "Completa primero los datos generales del proyecto.",
            "warning"
          );

          return;
        }

        showScreen("inputs");
      }
    );

  DOM.stepResultsButton
    .addEventListener(
      "click",
      () => {
        if (
          !ACSAppState.hasCalculated
        ) {
          return;
        }

        showScreen("results");
      }
    );

  DOM.demandProfileType
    .addEventListener(
      "change",
      updateCustomProfileVisibility
    );

  DOM.intrahourDemandProfileType
    .addEventListener(
      "change",
      () => {
        hideGlobalMessage();
      }
    );

  DOM.numberOfPeople
    .addEventListener(
      "input",
      updateDemandPreview
    );

  DOM.unitVolumeAt60CPerPersonDayL
    .addEventListener(
      "input",
      updateDemandPreview
    );

  getElement(
    "networkTemperatureC"
  ).addEventListener(
    "input",
    updateDemandPreview
  );

  DOM.customDemandProfile
    .addEventListener(
      "input",
      updateDemandPreview
    );

  DOM.customDemandProfile
    .addEventListener(
      "change",
      () => {
        const sourceValues =
          readCustomProfileSource();

        const hasChanged =
          sourceValues.some(
            (
              value,
              index
            ) =>
              value !==
              customDemandProfileValues[
                index
              ]
          );

        if (hasChanged) {
          refreshCustomDemandProfileEditorFromSource();
        }
      }
    );

  DOM.normalizeCustomProfileButton
    .addEventListener(
      "click",
      normalizeCustomDemandProfile
    );

  DOM.resetCustomProfileButton
    .addEventListener(
      "click",
      resetCustomDemandProfile
    );

  DOM.tankCount
    .addEventListener(
      "change",
      updateTank2Visibility
    );

  DOM.d1ExchangerType
    .addEventListener(
      "change",
      () =>
        updateExchangerVisibility(1)
    );

  DOM.d2ExchangerType
    .addEventListener(
      "change",
      () =>
        updateExchangerVisibility(2)
    );

  DOM.newProjectButton
    .addEventListener(
      "click",
      createNewProject
    );

  DOM.openProjectButton
    .addEventListener(
      "click",
      requestOpenProject
    );

  DOM.saveProjectButton
    .addEventListener(
      "click",
      requestSaveProject
    );

  DOM.saveInputsButton
    .addEventListener(
      "click",
      requestSaveProject
    );

  DOM.saveResultsProjectButton
    .addEventListener(
      "click",
      requestSaveProject
    );

  DOM.generatePdfButton
    .addEventListener(
      "click",
      requestGeneratePdf
    );

}


/* ============================================================
 * INICIALIZACIÓN
 * ============================================================ */

function ensureGeneratorDynamicInputs() {
  const generatorPowerInput =
    document.getElementById("generatorPowerKW");

  if (!generatorPowerInput) {
    return;
  }

  const host =
    generatorPowerInput.closest(
      ".form-group, .field, .input-group, .control-group"
    )?.parentElement ||
    generatorPowerInput.parentElement?.parentElement ||
    generatorPowerInput.parentElement;

  if (!host) {
    return;
  }

  const createNumberField = (
    id,
    labelText,
    defaultValue,
    helpText
  ) => {
    if (document.getElementById(id)) {
      return document.getElementById(id).closest(
        ".form-group, .field, .input-group, .control-group"
      );
    }

    const wrapper = document.createElement("div");
    wrapper.className =
      generatorPowerInput.closest(
        ".form-group, .field, .input-group, .control-group"
      )?.className || "form-group";

    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "number";
    input.id = id;
    input.name = id;
    input.min = "0";
    input.step = "0.1";
    input.value = String(defaultValue);

    wrapper.append(label, input);

    if (helpText) {
      const help = document.createElement("small");
      help.textContent = helpText;
      wrapper.append(help);
    }

    host.appendChild(wrapper);

    return wrapper;
  };

  createNumberField(
    "generatorRampMinutes",
    "Tiempo de rampa del generador (min)",
    0,
    "Tiempo para recorrer linealmente toda la potencia nominal."
  );

  createNumberField(
    "minimumGeneratorStartIntervalMinutes",
    "Intervalo mínimo entre arranques (min)",
    0,
    "Tiempo mínimo entre dos arranques consecutivos del generador."
  );

  let inertiaCheckbox =
    document.getElementById(
      "hasSufficientGeneratorInertia"
    );

  if (!inertiaCheckbox) {
    const wrapper = document.createElement("div");
    wrapper.className =
      generatorPowerInput.closest(
        ".form-group, .field, .input-group, .control-group"
      )?.className || "form-group";

    const label = document.createElement("label");
    label.htmlFor =
      "hasSufficientGeneratorInertia";

    inertiaCheckbox =
      document.createElement("input");
    inertiaCheckbox.type = "checkbox";
    inertiaCheckbox.id =
      "hasSufficientGeneratorInertia";
    inertiaCheckbox.name =
      "hasSufficientGeneratorInertia";
    inertiaCheckbox.checked = true;

    label.append(
      inertiaCheckbox,
      document.createTextNode(
        " Inercia suficiente en el circuito primario"
      )
    );

    const help = document.createElement("small");
    help.textContent =
      "Si está marcada, se mantiene la adaptación energética actual del generador a los intercambiadores.";

    wrapper.append(label, help);
    host.appendChild(wrapper);
  }

  const minimumPowerWrapper =
    createNumberField(
      "generatorMinimumPowerKW",
      "Potencia mínima del generador (kW)",
      0,
      "Sólo se aplica cuando la inercia no es suficiente."
    );

  const belowMinimumTimeWrapper =
    createNumberField(
      "maximumBelowMinimumPowerMinutes",
      "Tiempo máximo bajo potencia mínima (min)",
      5,
      "Al agotarse, el generador se para; el siguiente arranque respeta el intervalo mínimo entre arranques."
    );

  const updateInertiaDependentFields = () => {
    const sufficient = inertiaCheckbox.checked;

    [
      minimumPowerWrapper,
      belowMinimumTimeWrapper
    ].forEach(wrapper => {
      if (!wrapper) {
        return;
      }

      wrapper.hidden = sufficient;

      const input = wrapper.querySelector("input");
      if (input) {
        input.disabled = false;
      }
    });
  };

  inertiaCheckbox.addEventListener(
    "change",
    updateInertiaDependentFields
  );

  updateInertiaDependentFields();
}


function initializeApplication() {
  ensureGeneratorDynamicInputs();

  cacheDOMElements();

  registerEventListeners();

  const projectDate =
    getElement("projectDate");

  if (!projectDate.value) {
    projectDate.value =
      getLocalDateInputValue();
  }

  customDemandProfileValues =
    readCustomProfileSource();

  renderCustomDemandProfileEditor(
    false
  );

  updateTank2Visibility();

  updateCustomProfileVisibility();

  clearRenderedResults();

  ACSAppState.currentChartView =
    "load";

  setCalculationStatus(
    "Sin calcular"
  );

  showScreen("project");

  /*
   * Exposición limitada para los demás módulos.
   */
  window.ACSApp = Object.freeze({
    state:
      ACSAppState,

    showScreen,

    showMessage:
      showGlobalMessage,

    hideMessage:
      hideGlobalMessage,

    getSerializableState:
      getSerializableAppState,

    renderProjectSummary,

    refreshCustomDemandProfileEditor:
      refreshCustomDemandProfileEditorFromSource,

    refreshExchangerFields:
      updateAllExchangerVisibility,

    getIntrahourDemandProfileType() {
      return DOM
        .intrahourDemandProfileType
        .value;
    },

    getDemandProfilePreview() {
      return ACSAppState
        .demandProfilePreview;
    },

    renderDemandProfile:
      renderDemandProfileChart,

    formatNumber
  });
}


/**
 * Espera a que el HTML esté cargado.
 */
document.addEventListener(
  "DOMContentLoaded",
  initializeApplication
);