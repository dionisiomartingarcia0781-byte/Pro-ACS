"use strict";

/**
 * ============================================================
 * PRO ACS
 * APERTURA Y GUARDADO DE PROYECTOS
 * ============================================================
 *
 * Responsabilidades:
 *
 * - Guardar los datos generales del proyecto.
 * - Guardar las entradas técnicas.
 * - Abrir archivos de proyecto.
 * - Restaurar los formularios.
 * - Mantener compatibilidad entre versiones.
 *
 * Este archivo no guarda los resultados completos de simulación.
 * Los resultados se recalculan al pulsar "Calcular".
 */


/* ============================================================
 * CONFIGURACIÓN
 * ============================================================ */

const ACS_PROJECT_STORAGE_CONFIG =
  Object.freeze({
    FILE_VERSION:
      "1.3.0",

    FILE_EXTENSION:
      ".acs.json",

    MIME_TYPE:
      "application/json"
  });


/* ============================================================
 * ERRORES
 * ============================================================ */

class ACSProjectStorageError
  extends Error {
  constructor(
    message,
    details = null
  ) {
    super(message);

    this.name =
      "ACSProjectStorageError";

    this.details =
      details;
  }
}


/* ============================================================
 * UTILIDADES
 * ============================================================ */

/**
 * Obtiene un elemento obligatorio.
 */
function getElement(id) {
  const element =
    document.getElementById(id);

  if (!element) {
    throw new ACSProjectStorageError(
      `No se ha encontrado el elemento #${id}.`
    );
  }

  return element;
}


/**
 * Comprueba si un valor es un objeto simple.
 */
function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}


/**
 * Convierte un texto en un nombre seguro de archivo.
 */
function sanitizeFileName(value) {
  const source =
    String(
      value || "proyecto"
    )
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .replace(
        /[^a-zA-Z0-9_-]+/g,
        "-"
      )
      .replace(
        /-+/g,
        "-"
      )
      .replace(
        /^[-_]+|[-_]+$/g,
        ""
      );

  return (
    source || "proyecto"
  );
}


/**
 * Crea una copia serializable.
 */
function cloneObject(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}


/**
 * Comprueba que un valor sea un número finito.
 */
function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}


/**
 * Convierte un valor a número o devuelve null.
 */
function numberOrNull(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


/**
 * Muestra un mensaje usando app.js.
 */
function showMessage(
  message,
  type = "info"
) {
  if (
    window.ACSApp &&
    typeof window
      .ACSApp
      .showMessage ===
      "function"
  ) {
    window
      .ACSApp
      .showMessage(
        message,
        type
      );

    return;
  }

  console.log(message);
}


/* ============================================================
 * ESTRUCTURA DEL ARCHIVO
 * ============================================================ */

/**
 * Normaliza el estado recibido desde app.js.
 */
function createProjectFileData(
  appState
) {
  if (
    !appState ||
    typeof appState !== "object"
  ) {
    throw new ACSProjectStorageError(
      "El estado de la aplicación es obligatorio."
    );
  }

  const project =
    isObject(appState.project)
      ? cloneObject(
          appState.project
        )
      : {};

  const inputs =
    isObject(appState.inputs)
      ? cloneObject(
          appState.inputs
        )
      : null;

  return {
    fileType:
      "PRO_ACS_PROJECT",

    version:
      ACS_PROJECT_STORAGE_CONFIG
        .FILE_VERSION,

    application:
      "PRO ACS",

    savedAt:
      new Date()
        .toISOString(),

    project: {
      name:
        String(
          project.name || ""
        ),

      client:
        String(
          project.client || ""
        ),

      designer:
        String(
          project.designer || ""
        ),

      date:
        String(
          project.date || ""
        ),

      address:
        String(
          project.address || ""
        ),

      postalCode:
        String(
          project.postalCode || ""
        ),

      city:
        String(
          project.city || ""
        )
    },

    inputs,

    calculation: {
      calculated:
        Boolean(
          appState.calculated
        ),

      note:
        "Los resultados no se almacenan. Deben recalcularse al abrir el proyecto."
    }
  };
}


/**
 * Valida la estructura del archivo abierto.
 */
function validateProjectFileData(
  data
) {
  if (!isObject(data)) {
    throw new ACSProjectStorageError(
      "El archivo no contiene un objeto JSON válido."
    );
  }

  if (
    data.fileType !==
    "PRO_ACS_PROJECT"
  ) {
    throw new ACSProjectStorageError(
      "El archivo seleccionado no es un proyecto de PRO ACS."
    );
  }

  if (
    typeof data.version !==
    "string"
  ) {
    throw new ACSProjectStorageError(
      "El archivo no contiene una versión válida."
    );
  }

  if (!isObject(data.project)) {
    throw new ACSProjectStorageError(
      "El archivo no contiene los datos generales del proyecto."
    );
  }

  if (
    data.inputs !== null &&
    !isObject(data.inputs)
  ) {
    throw new ACSProjectStorageError(
      "Los datos técnicos guardados no son válidos."
    );
  }

  return true;
}


/* ============================================================
 * GUARDADO
 * ============================================================ */

/**
 * Descarga un objeto como archivo JSON.
 */
function downloadJsonFile(
  data,
  fileName
) {
  const json =
    JSON.stringify(
      data,
      null,
      2
    );

  const blob =
    new Blob(
      [json],
      {
        type:
          ACS_PROJECT_STORAGE_CONFIG
            .MIME_TYPE
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement("a");

  link.href =
    url;

  link.download =
    fileName;

  document.body.appendChild(
    link
  );

  link.click();

  link.remove();

  window.setTimeout(
    () => {
      URL.revokeObjectURL(
        url
      );
    },
    1000
  );
}


/**
 * Guarda el estado actual.
 */
function saveCurrentProject(
  appState
) {
  const fileData =
    createProjectFileData(
      appState
    );

  const projectName =
    fileData.project.name ||
    "proyecto";

  const datePart =
    fileData.project.date
      ? `_${fileData.project.date}`
      : "";

  const fileName =
    `${sanitizeFileName(
      projectName
    )}${datePart}${
      ACS_PROJECT_STORAGE_CONFIG
        .FILE_EXTENSION
    }`;

  downloadJsonFile(
    fileData,
    fileName
  );

  showMessage(
    `Proyecto guardado como "${fileName}".`,
    "success"
  );

  return {
    fileName,
    fileData
  };
}


/* ============================================================
 * LECTURA DE ARCHIVOS
 * ============================================================ */

/**
 * Lee un archivo como texto.
 */
function readFileAsText(file) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const reader =
        new FileReader();

      reader.onload =
        () => {
          resolve(
            String(
              reader.result || ""
            )
          );
        };

      reader.onerror =
        () => {
          reject(
            new ACSProjectStorageError(
              "No se ha podido leer el archivo."
            )
          );
        };

      reader.readAsText(
        file,
        "UTF-8"
      );
    }
  );
}


/**
 * Abre y procesa un archivo.
 */
async function openProjectFile(
  file
) {
  if (!(file instanceof File)) {
    throw new ACSProjectStorageError(
      "No se ha recibido un archivo válido."
    );
  }

  const fileText =
    await readFileAsText(
      file
    );

  let data;

  try {
    data =
      JSON.parse(
        fileText
      );
  } catch (error) {
    throw new ACSProjectStorageError(
      "El archivo no contiene JSON válido.",
      {
        originalError:
          error.message
      }
    );
  }

  validateProjectFileData(
    data
  );

  restoreProjectData(
    data
  );

  showMessage(
    `Proyecto "${data.project.name || file.name}" abierto correctamente. Pulsa Calcular para actualizar los resultados.`,
    "success"
  );

  return data;
}


/* ============================================================
 * RESTAURACIÓN DE DATOS GENERALES
 * ============================================================ */

/**
 * Asigna un valor a un campo.
 */
function setFieldValue(
  id,
  value
) {
  const element =
    getElement(id);

  element.value =
    value ?? "";
}


/**
 * Restaura la pantalla inicial.
 */
function restoreGeneralProjectData(
  project
) {
  setFieldValue(
    "projectName",
    project.name
  );

  setFieldValue(
    "projectClient",
    project.client || ""
  );

  setFieldValue(
    "projectDesigner",
    project.designer
  );

  setFieldValue(
    "projectDate",
    project.date
  );

  setFieldValue(
    "projectAddress",
    project.address
  );

  setFieldValue(
    "projectPostalCode",
    project.postalCode
  );

  setFieldValue(
    "projectCity",
    project.city
  );
}


/* ============================================================
 * RESTAURACIÓN DE DATOS TÉCNICOS
 * ============================================================ */

/**
 * Asigna un campo únicamente cuando el archivo contiene el dato.
 * Permite abrir proyectos de versiones anteriores conservando
 * el valor predeterminado actual para los parámetros nuevos.
 */
function setFieldValueIfPresent(
  id,
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  setFieldValue(id, value);
}

/**
 * Restaura el perfil de demanda.
 */
function restoreDemandInputs(
  inputs
) {
  const demand =
    inputs.demandProfile;

  if (!isObject(demand)) {
    return;
  }

  setFieldValue(
    "demandProfileType",
    demand.profileType ||
    "residential"
  );

  setFieldValue(
    "intrahourDemandProfileType",
    inputs.intrahourDemandProfileType ||
    "uniform"
  );

  setFieldValue(
    "numberOfPeople",
    demand.numberOfPeople
  );

  setFieldValue(
    "unitVolumeAt60CPerPersonDayL",
    demand
      .unitVolumeAt60CPerPersonDayL
  );

  if (
    demand.profileType ===
    "custom"
  ) {
    const percentages =
      Array.isArray(
        demand
          .customHourlyPercentages
      )
        ? demand
            .customHourlyPercentages
        : (
            Array.isArray(
              demand
                .hourlyDistributionPercent
            )
              ? demand
                  .hourlyDistributionPercent
              : null
          );

    if (percentages) {
      setFieldValue(
        "customDemandProfile",
        percentages.join(", ")
      );
    }
  }

  getElement(
    "demandProfileType"
  ).dispatchEvent(
    new Event(
      "change",
      {
        bubbles: true
      }
    )
  );
}


/**
 * Restaura temperaturas y recirculación.
 */
function restoreTemperatureInputs(
  inputs
) {
  setFieldValue(
    "storageTemperatureC",
    inputs.storageTemperatureC
  );

  setFieldValue(
    "useTemperatureC",
    inputs.useTemperatureC
  );

  setFieldValue(
    "networkTemperatureC",
    inputs.networkTemperatureC
  );

  setFieldValueIfPresent(
    "lossPercent",
    inputs.lossPercent
  );
}


/**
 * Restaura la caracterización térmica de placas y serpentines.
 */
function restoreImmersedTankInputs(
  tankNumber,
  tank
) {
  const prefix = `d${tankNumber}`;
  const fields = {
    NominalPrimaryInletTemperatureC:
      tank.nominalPrimaryInletTemperatureC,
    NominalPrimaryOutletTemperatureC:
      tank.nominalPrimaryOutletTemperatureC,
    NominalSecondaryInletTemperatureC:
      tank.nominalSecondaryInletTemperatureC,
    NominalSecondaryOutletTemperatureC:
      tank.nominalSecondaryOutletTemperatureC,
    ActualPrimaryInletTemperatureC:
      tank.actualPrimaryInletTemperatureC,
    ActualPrimaryOutletTemperatureC:
      tank.actualPrimaryOutletTemperatureC
  };

  Object.entries(fields).forEach(
    ([suffix, value]) => {
      setFieldValueIfPresent(
        `${prefix}${suffix}`,
        value
      );
    }
  );
}


/**
 * Restaura depósitos.
 */
function restoreTankInputs(
  inputs
) {
  const tankCount =
    numberOrNull(
      inputs.tankCount
    );

  const tanks =
    Array.isArray(inputs.tanks)
      ? inputs.tanks
      : [];

  if (
    tankCount !== 1 &&
    tankCount !== 2
  ) {
    return;
  }

  setFieldValue(
    "tankCount",
    tankCount
  );

  if (tanks[0]) {
    setFieldValue(
      "d1VolumeL",
      tanks[0].volumeL
    );

    setFieldValue(
      "d1ExchangerType",
      tanks[0].exchangerType ||
      "plate"
    );

    setFieldValue(
      "d1ExchangerPowerKW",
      tanks[0]
        .exchangerPowerKW
    );

    restoreImmersedTankInputs(
      1,
      tanks[0]
    );
  }

  if (
    tankCount === 2 &&
    tanks[1]
  ) {
    setFieldValue(
      "d2VolumeL",
      tanks[1].volumeL
    );

    setFieldValue(
      "d2ExchangerType",
      tanks[1].exchangerType ||
      "plate"
    );

    setFieldValue(
      "d2ExchangerPowerKW",
      tanks[1]
        .exchangerPowerKW
    );

    restoreImmersedTankInputs(
      2,
      tanks[1]
    );
  }

  getElement(
    "tankCount"
  ).dispatchEvent(
    new Event(
      "change",
      {
        bubbles: true
      }
    )
  );

  ["d1ExchangerType", "d2ExchangerType"]
    .forEach(id => {
      getElement(id).dispatchEvent(
        new Event("change", { bubbles: true })
      );
    });
}


/**
 * Restaura generador y control.
 */
function restoreGeneratorInputs(
  inputs
) {
  setFieldValue(
    "generatorPowerKW",
    inputs.generatorPowerKW
  );

  setFieldValue(
    "startThresholdPercent",
    inputs.startThresholdPercent
  );

  setFieldValueIfPresent(
    "generatorRampMinutes",
    inputs.generatorRampMinutes
  );

  setFieldValueIfPresent(
    "minimumGeneratorStartIntervalMinutes",
    inputs.minimumGeneratorStartIntervalMinutes
  );

  setFieldValueIfPresent(
    "generatorMinimumPowerKW",
    inputs.generatorMinimumPowerKW
  );

  setFieldValueIfPresent(
    "maximumBelowMinimumPowerMinutes",
    inputs.maximumBelowMinimumPowerMinutes
  );

  const inertiaField =
    getElement(
      "hasSufficientGeneratorInertia"
    );

  inertiaField.checked =
    inputs.hasSufficientGeneratorInertia !==
    false;

  inertiaField.dispatchEvent(
    new Event("change", { bubbles: true })
  );

  getElement(
    "sanitaryCheck"
  ).checked =
    inputs.sanitaryCheck !== false;
}


/**
 * Restaura la configuración técnica completa.
 */
function restoreTechnicalInputs(
  inputs
) {
  if (!isObject(inputs)) {
    return;
  }

  restoreDemandInputs(
    inputs
  );

  restoreTemperatureInputs(
    inputs
  );

  restoreTankInputs(
    inputs
  );

  restoreGeneratorInputs(
    inputs
  );
}


/* ============================================================
 * RESTAURACIÓN DEL ESTADO DE APP.JS
 * ============================================================ */

/**
 * Restablece visualmente los resultados.
 */
function clearExistingResults() {
  const resultsButton =
    document.getElementById(
      "stepResultsButton"
    );

  if (resultsButton) {
    resultsButton.disabled = true;
  }

  const resultsGrid =
    document.getElementById(
      "generalResultsGrid"
    );

  if (resultsGrid) {
    resultsGrid.innerHTML = "";
  }

  const tankBody =
    document.getElementById(
      "tankResultsTableBody"
    );

  if (tankBody) {
    tankBody.innerHTML = `
      <tr>
        <td colspan="7">
          Sin resultados disponibles.
        </td>
      </tr>
    `;
  }

  if (
    window.ACSCharts &&
    typeof window
      .ACSCharts
      .clear ===
      "function"
  ) {
    window.ACSCharts.clear();
  }
}


/**
 * Restaura la aplicación desde un archivo.
 */
function restoreProjectData(
  fileData
) {
  restoreGeneralProjectData(
    fileData.project
  );

  restoreTechnicalInputs(
    fileData.inputs
  );

  clearExistingResults();

  if (
    window.ACSApp &&
    window.ACSApp.state
  ) {
    window.ACSApp.state.projectData =
      cloneObject(
        fileData.project
      );

    window.ACSApp.state.inputConfig =
      fileData.inputs
        ? cloneObject(
            fileData.inputs
          )
        : null;

    window.ACSApp.state.simulationResult =
      null;

    window.ACSApp.state.analysisResult =
      null;

    window.ACSApp.state.hasCalculated =
      false;
  }

  if (
    window.ACSApp &&
    typeof window
      .ACSApp
      .renderProjectSummary ===
      "function"
  ) {
    window
      .ACSApp
      .renderProjectSummary(
        fileData.project
      );
  }

  if (
    window.ACSApp &&
    typeof window
      .ACSApp
      .showScreen ===
      "function"
  ) {
    window
      .ACSApp
      .showScreen(
        fileData.inputs
          ? "inputs"
          : "project"
      );
  }
}


/* ============================================================
 * EVENTO DEL INPUT DE ARCHIVO
 * ============================================================ */

/**
 * Gestiona la selección del archivo.
 */
async function handleFileInputChange(
  event
) {
  const input =
    event.target;

  const file =
    input.files?.[0];

  if (!file) {
    return;
  }

  try {
    await openProjectFile(
      file
    );
  } catch (error) {
    showMessage(
      error.message ||
      "No se ha podido abrir el proyecto.",
      "error"
    );

    console.error(error);
  } finally {
    /*
     * Permite volver a abrir el mismo archivo.
     */
    input.value = "";
  }
}


/* ============================================================
 * INICIALIZACIÓN
 * ============================================================ */

function initializeProjectStorage() {
  const input =
    document.getElementById(
      "projectFileInput"
    );

  if (!input) {
    console.warn(
      "No se ha encontrado #projectFileInput."
    );

    return;
  }

  input.addEventListener(
    "change",
    handleFileInputChange
  );
}


/* ============================================================
 * API PÚBLICA
 * ============================================================ */

const ACSProjectStorage =
  Object.freeze({
    version:
      ACS_PROJECT_STORAGE_CONFIG
        .FILE_VERSION,

    saveCurrentProject,

    openProjectFile,

    restoreProjectData,

    createProjectFileData,

    validateProjectFileData
  });


/* ============================================================
 * EXPORTACIÓN
 * ============================================================ */

if (
  typeof window !==
  "undefined"
) {
  window.ACSProjectStorage =
    ACSProjectStorage;

  document.addEventListener(
    "DOMContentLoaded",
    initializeProjectStorage
  );
}


if (
  typeof module !==
    "undefined" &&
  module.exports
) {
  module.exports = {
    ACSProjectStorage,

    ACSProjectStorageError,

    ACS_PROJECT_STORAGE_CONFIG
  };
}