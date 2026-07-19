"use strict";

/**
 * ============================================================
 * PRO ACS
 * BLOQUE 7 · ANÁLISIS, VALORACIONES Y PRESENTACIÓN
 * ============================================================
 *
 * Este archivo no modifica la física de la simulación.
 *
 * Responsabilidades:
 *
 * - Leer el resultado validado de los bloques 1 a 6.
 * - Preparar los resultados generales.
 * - Calcular tiempos teóricos de calentamiento.
 * - Crear la valoración sanitaria.
 * - Crear la valoración de confort.
 * - Crear la valoración de pérdidas.
 * - Preparar los datos de las gráficas.
 * - Preparar conclusiones y textos para el informe.
 * - Renderizar los resultados en la pantalla 3.
 */


/* ============================================================
 * CONSTANTES DEL BLOQUE 7
 * ============================================================ */

const ACS_BLOCK7_CONSTANTS =
  Object.freeze({
    SANITARY_TEMPERATURE_C: 60,

    SANITARY_MAX_MINUTES_BELOW_60_C:
      30,

    COMFORT_TIGHT_MAX_PERCENT:
      30,

    COMFORT_COMPLIANT_MAX_PERCENT:
      60,

    LOW_LOSSES_MAX_PERCENT:
      5,

    USUAL_LOSSES_MAX_PERCENT:
      15,

    ENERGY_EPSILON_KWH:
      1e-9,

    VERSION:
      "1.3.0"
  });


/* ============================================================
 * ERRORES
 * ============================================================ */

/**
 * Error específico del bloque 7.
 */
class ACSBlock7Error extends Error {
  constructor(
    message,
    details = null
  ) {
    super(message);

    this.name =
      "ACSBlock7Error";

    this.details =
      details;
  }
}


/* ============================================================
 * UTILIDADES GENERALES
 * ============================================================ */

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
 * Devuelve un número o un valor alternativo.
 */
function finiteOrFallback(
  value,
  fallback = 0
) {
  return isFiniteNumber(value)
    ? value
    : fallback;
}


/**
 * Suma una colección de números.
 */
function sumNumbers(values) {
  if (!Array.isArray(values)) {
    return 0;
  }

  return values.reduce(
    (
      total,
      value
    ) =>
      total +
      finiteOrFallback(
        value,
        0
      ),
    0
  );
}


/**
 * Obtiene el mínimo de una colección.
 */
function minimumNumber(
  values,
  fallback = null
) {
  if (!Array.isArray(values)) {
    return fallback;
  }

  const finiteValues =
    values.filter(
      isFiniteNumber
    );

  if (
    finiteValues.length === 0
  ) {
    return fallback;
  }

  return Math.min(
    ...finiteValues
  );
}


/**
 * Obtiene el máximo de una colección.
 */
function maximumNumber(
  values,
  fallback = null
) {
  if (!Array.isArray(values)) {
    return fallback;
  }

  const finiteValues =
    values.filter(
      isFiniteNumber
    );

  if (
    finiteValues.length === 0
  ) {
    return fallback;
  }

  return Math.max(
    ...finiteValues
  );
}


/**
 * Obtiene la media aritmética.
 */
function averageNumber(
  values,
  fallback = 0
) {
  if (!Array.isArray(values)) {
    return fallback;
  }

  const finiteValues =
    values.filter(
      isFiniteNumber
    );

  if (
    finiteValues.length === 0
  ) {
    return fallback;
  }

  return (
    sumNumbers(finiteValues) /
    finiteValues.length
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
 * Copia un objeto serializable.
 */
function cloneObject(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}


/**
 * Formatea un número para la UI.
 */
function formatNumber(
  value,
  maximumFractionDigits = 2
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
 * Formatea una duración en minutos.
 *
 * Ejemplos:
 *
 * 35 min
 * 1 h 20 min
 */
function formatDurationMinutes(
  totalMinutes
) {
  if (!isFiniteNumber(totalMinutes)) {
    return "No calculable";
  }

  const roundedMinutes =
    Math.round(totalMinutes);

  if (roundedMinutes < 60) {
    return `${roundedMinutes} min`;
  }

  const hours =
    Math.floor(
      roundedMinutes / 60
    );

  const minutes =
    roundedMinutes % 60;

  if (minutes === 0) {
    return `${hours} h`;
  }

  return (
    `${hours} h ${minutes} min`
  );
}


/**
 * Convierte un valor en texto seguro para HTML.
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
 * VALIDACIÓN DE ENTRADA
 * ============================================================ */

/**
 * Comprueba la estructura básica recibida desde app.js.
 */
function validateAnalysisInput(input) {
  if (
    !input ||
    typeof input !== "object"
  ) {
    throw new ACSBlock7Error(
      "La entrada del bloque 7 es obligatoria."
    );
  }

  if (
    !input.engineResult ||
    typeof input.engineResult !==
      "object"
  ) {
    throw new ACSBlock7Error(
      "Falta el resultado del motor."
    );
  }

  const simulation =
    input.engineResult.simulation;

  if (
    !simulation ||
    typeof simulation !==
      "object"
  ) {
    throw new ACSBlock7Error(
      "Falta simulation dentro del resultado del motor."
    );
  }

  const analysis =
    simulation.results
      ?.analysis;

  if (
    !analysis ||
    !Array.isArray(
      analysis.hourly
    ) ||
    !analysis.totals
  ) {
    throw new ACSBlock7Error(
      "El resultado no contiene el periodo de análisis de 24 horas."
    );
  }

  if (
    analysis.hourly.length !== 24
  ) {
    throw new ACSBlock7Error(
      "El bloque 7 esperaba 24 resultados horarios.",
      {
        receivedHours:
          analysis.hourly.length
      }
    );
  }

  return true;
}


/* ============================================================
 * ACCESO A LOS RESULTADOS DEL MOTOR
 * ============================================================ */

/**
 * Obtiene los objetos principales de la simulación.
 */
function getSimulationContext(
  engineResult
) {
  const simulation =
    engineResult.simulation;

  return {
    engineResult,

    simulation,

    config:
      simulation.config,

    metadata:
      simulation.metadata,

    validation:
      engineResult.validation,

    summary:
      engineResult.summary,

    ui:
      engineResult.ui,

    hourly:
      simulation
        .results
        .analysis
        .hourly,

    minutes:
      simulation
        .results
        .analysis
        .minute || [],

    generatorOperation:
      simulation
        .results
        .analysis
        .generatorOperation || null,

    totals:
      simulation
        .results
        .analysis
        .totals,

    finalState:
      simulation.finalState
  };
}


/* ============================================================
 * DATOS GENERALES DEL PROYECTO
 * ============================================================ */

/**
 * Normaliza los datos identificativos.
 */
function createProjectInformation(
  project
) {
  const source =
    project &&
    typeof project === "object"
      ? project
      : {};

  return {
    name:
      String(
        source.name || ""
      ),

    designer:
      String(
        source.designer || ""
      ),

    date:
      String(
        source.date || ""
      ),

    address:
      String(
        source.address || ""
      ),

    postalCode:
      String(
        source.postalCode || ""
      ),

    city:
      String(
        source.city || ""
      )
  };
}


/* ============================================================
 * TIEMPOS DE CALENTAMIENTO
 * ============================================================ */

/**
 * Calcula el tiempo teórico de calentamiento de un depósito.
 *
 * Se calcula:
 *
 * - desde Tred;
 * - hasta Tacum;
 * - sin consumo;
 * - sin recirculación;
 * - sin pérdidas;
 * - actualizando la potencia efectiva del intercambiador durante
 *   todo el proceso de carga.
 */
function calculateTankHeatingTime(
  tankState,
  options = {}
) {
  if (
    !tankState ||
    typeof tankState !== "object"
  ) {
    throw new ACSBlock7Error(
      "El estado del depósito es obligatorio."
    );
  }

  const maximumUsefulEnergyKWh =
    finiteOrFallback(
      tankState
        .maximumUsefulEnergyKWh,
      0
    );

  const exchangerPowerKW =
    finiteOrFallback(
      tankState
        .exchangerPowerKW,
      0
    );

  const initialEffectiveExchangerPowerKW =
    finiteOrFallback(
      tankState
        .effectiveExchangerPowerKW,
      exchangerPowerKW
    );

  const exchangerType =
    tankState.exchangerType ||
    "plate";

  const dependencies =
    getSystemHeatingDependencies();

  const storageTemperatureC =
    finiteOrFallback(
      options.storageTemperatureC,
      NaN
    );

  const networkTemperatureC =
    finiteOrFallback(
      options.networkTemperatureC,
      NaN
    );

  const maximumMinutes =
    isFiniteNumber(options.maximumMinutes)
      ? Math.max(
          1,
          Math.floor(options.maximumMinutes)
        )
      : 7 * 24 * 60;

  const canSimulate =
    exchangerPowerKW > 0 &&
    dependencies &&
    isFiniteNumber(storageTemperatureC) &&
    isFiniteNumber(networkTemperatureC);

  let heatingTimeMinutes = null;
  let finalEffectiveExchangerPowerKW =
    initialEffectiveExchangerPowerKW;

  if (canSimulate) {
    const tank =
      new dependencies.ACSTank({
        id: tankState.id,
        volumeL: tankState.volumeL,
        exchangerType,
        exchangerPowerKW,
        storageTemperatureC,
        networkTemperatureC,
        initialLoadPercent: 0,
        nominalPrimaryInletTemperatureC:
          tankState
            .nominalPrimaryInletTemperatureC,
        nominalPrimaryOutletTemperatureC:
          tankState
            .nominalPrimaryOutletTemperatureC,
        nominalSecondaryInletTemperatureC:
          tankState
            .nominalSecondaryInletTemperatureC,
        nominalSecondaryOutletTemperatureC:
          tankState
            .nominalSecondaryOutletTemperatureC,
        actualPrimaryInletTemperatureC:
          tankState
            .actualPrimaryInletTemperatureC,
        actualPrimaryOutletTemperatureC:
          tankState
            .actualPrimaryOutletTemperatureC
      });

    let elapsedMinutes = 0;

    while (
      elapsedMinutes < maximumMinutes &&
      !tank.isFull
    ) {
      const generation =
        tank.applyPower(
          exchangerPowerKW,
          1
        );

      if (
        generation.absorbedEnergyKWh <=
        ACS_BLOCK7_CONSTANTS
          .ENERGY_EPSILON_KWH
      ) {
        break;
      }

      elapsedMinutes +=
        tank.isFull
          ? generation.effectiveMinutes
          : 1;
    }

    if (tank.isFull) {
      heatingTimeMinutes =
        elapsedMinutes;
    }

    finalEffectiveExchangerPowerKW =
      tank.effectiveExchangerPowerKW;
  }

  const canHeat =
    heatingTimeMinutes !== null;

  const heatingTimeHours =
    canHeat
      ? heatingTimeMinutes / 60
      : null;

  return {
    tankId:
      tankState.id,

    volumeL:
      tankState.volumeL,

    exchangerType,

    exchangerPowerKW,

    effectiveExchangerPowerKW:
      initialEffectiveExchangerPowerKW,

    finalEffectiveExchangerPowerKW,

    maximumUsefulEnergyKWh,

    canHeat,

    heatingTimeHours,

    heatingTimeMinutes
  };
}


/**
 * Obtiene las dependencias necesarias para simular el calentamiento
 * conjunto de los depósitos.
 */
function getSystemHeatingDependencies() {
  if (
    typeof window === "undefined"
  ) {
    return null;
  }

  const engine =
    window.ACSSimulationEngine;

  const block4 =
    window.ACSBlock4;

  if (
    !engine ||
    !engine.classes ||
    typeof engine
      .classes
      .ACSTank !== "function" ||
    typeof engine
      .classes
      .ACSGeneratorState !== "function" ||
    !block4 ||
    typeof block4
      .applyGeneratorForMinute !==
      "function"
  ) {
    return null;
  }

  return {
    ACSTank:
      engine.classes.ACSTank,

    ACSGeneratorState:
      engine
        .classes
        .ACSGeneratorState,

    applyGeneratorForMinute:
      block4
        .applyGeneratorForMinute
  };
}


/**
 * Calcula el tiempo teórico de calentamiento conjunto.
 *
 * Condiciones:
 * - depósitos inicialmente vacíos;
 * - sin demanda;
 * - sin recirculación;
 * - sin pérdidas;
 * - generador disponible continuamente;
 * - prioridad real de D2 en instalaciones de dos depósitos;
 * - límite del generador;
 * - límite y corrección dinámica de cada intercambiador.
 */
function calculateSystemHeatingTime(
  context,
  options = {}
) {
  const dependencies =
    getSystemHeatingDependencies();

  if (!dependencies) {
    return {
      calculable: false,

      reachedFullLoad: false,

      heatingTimeMinutes: null,
      heatingTimeHours: null,

      reason:
        "No están disponibles las funciones internas necesarias para simular el calentamiento conjunto."
    };
  }

  const maximumMinutes =
    isFiniteNumber(
      options.maximumMinutes
    )
      ? Math.max(
          1,
          Math.floor(
            options.maximumMinutes
          )
        )
      : 7 * 24 * 60;

  const noProgressLimitMinutes =
    isFiniteNumber(
      options.noProgressLimitMinutes
    )
      ? Math.max(
          1,
          Math.floor(
            options
              .noProgressLimitMinutes
          )
        )
      : 120;

  const {
    ACSTank,
    ACSGeneratorState,
    applyGeneratorForMinute
  } = dependencies;

  const heatingConfig = {
    ...cloneObject(
      context.config
    ),

    recirculationFlowLPerMinute: 0,
    lossPercent: 0,
    sanitaryCheck: false
  };

  const tanks =
    heatingConfig.tanks.map(
      tankConfig =>
        new ACSTank({
          ...tankConfig,
          initialLoadPercent: 0
        })
    );

  const generatorState =
    new ACSGeneratorState();

  generatorState.running = true;

  let elapsedMinutes = 0;
  let noProgressMinutes = 0;

  let previousStoredEnergyKWh =
    sumNumbers(
      tanks.map(
        tank =>
          tank.energyKWh
      )
    );

  while (
    elapsedMinutes <
      maximumMinutes &&
    !tanks.every(
      tank =>
        tank.isFull
    )
  ) {
    const generation =
      applyGeneratorForMinute({
        config:
          heatingConfig,

        tanks,

        generatorState,

        intervalMinutes: 1
      });

    elapsedMinutes += 1;

    const storedEnergyKWh =
      sumNumbers(
        tanks.map(
          tank =>
            tank.energyKWh
        )
      );

    const energyIncreaseKWh =
      storedEnergyKWh -
      previousStoredEnergyKWh;

    if (
      energyIncreaseKWh <=
      ACS_BLOCK7_CONSTANTS
        .ENERGY_EPSILON_KWH
    ) {
      noProgressMinutes += 1;
    } else {
      noProgressMinutes = 0;
    }

    previousStoredEnergyKWh =
      storedEnergyKWh;

    if (
      generation.absorbedEnergyKWh <=
        ACS_BLOCK7_CONSTANTS
          .ENERGY_EPSILON_KWH &&
      noProgressMinutes >=
        noProgressLimitMinutes
    ) {
      break;
    }
  }

  const reachedFullLoad =
    tanks.every(
      tank =>
        tank.isFull
    );

  return {
    calculable: true,

    reachedFullLoad,

    heatingTimeMinutes:
      reachedFullLoad
        ? elapsedMinutes
        : null,

    heatingTimeHours:
      reachedFullLoad
        ? elapsedMinutes / 60
        : null,

    maximumMinutes,

    finalLoads:
      tanks.map(
        tank => ({
          tankId:
            tank.id,

          loadPercent:
            tank.loadPercent,

          effectiveExchangerPowerKW:
            tank
              .effectiveExchangerPowerKW
        })
      ),

    reason:
      reachedFullLoad
        ? null
        : (
            "El sistema no ha alcanzado el 100 % de carga dentro del límite de simulación o ha quedado sin progreso térmico."
          )
  };
}


/**
 * Calcula los tiempos individuales y el tiempo conjunto real
 * según la lógica de generación del motor.
 */
function createHeatingTimeResults(
  context
) {
  const tankStates =
    context.finalState
      ?.tanks;

  if (
    !Array.isArray(
      tankStates
    )
  ) {
    throw new ACSBlock7Error(
      "No se han encontrado los estados finales de los depósitos."
    );
  }

  const tanks =
    tankStates.map(
      tankState =>
        calculateTankHeatingTime(
          tankState,
          {
            storageTemperatureC:
              context.config
                .storageTemperatureC,

            networkTemperatureC:
              context.config
                .networkTemperatureC
          }
        )
    );

  const systemHeating =
    calculateSystemHeatingTime(
      context
    );

  return {
    tanks,

    total: {
      volumeL:
        sumNumbers(
          tanks.map(
            tank =>
              tank.volumeL
          )
        ),

      maximumUsefulEnergyKWh:
        sumNumbers(
          tanks.map(
            tank =>
              tank
                .maximumUsefulEnergyKWh
          )
        ),

      canHeat:
        systemHeating
          .calculable &&
        systemHeating
          .reachedFullLoad,

      heatingTimeHours:
        systemHeating
          .heatingTimeHours,

      heatingTimeMinutes:
        systemHeating
          .heatingTimeMinutes,

      calculation:
        systemHeating
    },

    note:
      "Los tiempos individuales se simulan desde la temperatura de red hasta la temperatura de acumulación, sin consumos, recirculación ni pérdidas, actualizando durante toda la carga la potencia efectiva de cada intercambiador.",

    totalNote:
      systemHeating.reachedFullLoad
        ? (
            "El tiempo total del sistema se obtiene mediante una simulación conjunta desde depósitos vacíos, respetando la potencia del generador, la prioridad de carga, la potencia disponible y la corrección dinámica de cada intercambiador."
          )
        : (
            "No ha sido posible determinar un tiempo total hasta el 100 % porque el sistema no ha completado la carga en la simulación teórica conjunta."
          )
  };
}


/* ============================================================
 * INDICADORES HIDRÁULICOS
 * ============================================================ */

/**
 * Calcula los indicadores hidráulicos de las últimas 24 horas.
 */
function createHydraulicResults(
  context
) {
  const minuteResults =
    context.minutes;

  const useFlowsLPerMinute =
    minuteResults.map(
      minute =>
        minute
          .comfort
          .equivalentDemandVolumeL
    );

  const tankReturnFlowsLPerMinute =
    minuteResults.map(
      minute =>
        minute
          .iterativeResolution
          .hydraulicState
          .tankRecirculationVolumeL
    );

  const bypassReturnFlowsLPerMinute =
    minuteResults.map(
      minute =>
        minute
          .iterativeResolution
          .hydraulicState
          .bypassRecirculationVolumeL
    );

  const totalReturnFlowLPerMinute =
    context.config
      .recirculationFlowLPerMinute;

  return {
    maximumUseFlowLPerMinute:
      maximumNumber(
        useFlowsLPerMinute,
        0
      ),

    totalReturnFlowLPerMinute,

    averageTankReturnFlowLPerMinute:
      averageNumber(
        tankReturnFlowsLPerMinute,
        0
      ),

    maximumTankReturnFlowLPerMinute:
      maximumNumber(
        tankReturnFlowsLPerMinute,
        0
      ),

    minimumTankReturnFlowLPerMinute:
      minimumNumber(
        tankReturnFlowsLPerMinute,
        0
      ),

    averageBypassReturnFlowLPerMinute:
      averageNumber(
        bypassReturnFlowsLPerMinute,
        0
      ),

    maximumBypassReturnFlowLPerMinute:
      maximumNumber(
        bypassReturnFlowsLPerMinute,
        0
      ),

    averageTankReturnPercent:
      totalReturnFlowLPerMinute > 0
        ? clamp(
            averageNumber(
              tankReturnFlowsLPerMinute,
              0
            ) /
            totalReturnFlowLPerMinute *
            100,
            0,
            100
          )
        : 0
  };
}


/* ============================================================
 * RESULTADOS DE DEPÓSITOS
 * ============================================================ */

/**
 * Prepara los resultados individuales de los depósitos.
 */
function createTankResults(
  context,
  heatingTimes
) {
  const periodTanks =
    context.totals.tanks;

  const finalTanks =
    context.finalState.tanks;

  return periodTanks.map(
    (
      tankTotals,
      index
    ) => {
      const finalTank =
        finalTanks[index];

      const heating =
        heatingTimes
          .tanks[index];

      const exchangerTotals =
        tankTotals.exchanger ||
        {};

      const exchangerType =
        finalTank.exchangerType ||
        exchangerTotals.type ||
        "plate";

      const nominalPowerKW =
        finiteOrFallback(
          finalTank.exchangerPowerKW,
          0
        );

      const averageEffectivePowerKW =
        finiteOrFallback(
          exchangerTotals
            .averageEffectivePowerKW,
          nominalPowerKW
        );

      const averageCorrectionFactor =
        finiteOrFallback(
          exchangerTotals
            .averageCorrectionFactor,
          nominalPowerKW > 0
            ? averageEffectivePowerKW /
              nominalPowerKW
            : 1
        );

      const deratingPercent =
        clamp(
          (
            1 -
            averageCorrectionFactor
          ) *
          100,
          0,
          100
        );

      return {
        tankId:
          tankTotals.tankId,

        volumeL:
          finalTank.volumeL,

        exchangerType,

        exchangerTypeLabel:
          exchangerType === "immersed"
            ? "Serpentín sumergido"
            : "Intercambiador de placas",

        exchangerPowerKW:
          nominalPowerKW,

        averageEffectivePowerKW,

        minimumEffectivePowerKW:
          finiteOrFallback(
            exchangerTotals
              .minimumEffectivePowerKW,
            averageEffectivePowerKW
          ),

        maximumEffectivePowerKW:
          finiteOrFallback(
            exchangerTotals
              .maximumEffectivePowerKW,
            nominalPowerKW
          ),

        finalEffectivePowerKW:
          finiteOrFallback(
            exchangerTotals
              .finalEffectivePowerKW,
            finalTank
              .effectiveExchangerPowerKW
          ),

        averageCorrectionFactor:
          clamp(
            averageCorrectionFactor,
            0,
            1
          ),

        minimumCorrectionFactor:
          clamp(
            finiteOrFallback(
              exchangerTotals
                .minimumCorrectionFactor,
              averageCorrectionFactor
            ),
            0,
            1
          ),

        finalCorrectionFactor:
          clamp(
            finiteOrFallback(
              exchangerTotals
                .finalCorrectionFactor,
              finalTank
                .thermalCorrectionFactor
            ),
            0,
            1
          ),

        deratingPercent,

        deratingMinutes:
          finiteOrFallback(
            exchangerTotals
              .deratingMinutes,
            0
          ),

        nominalPrimaryInletTemperatureC:
          finalTank
            .nominalPrimaryInletTemperatureC,

        nominalPrimaryOutletTemperatureC:
          finalTank
            .nominalPrimaryOutletTemperatureC,

        nominalSecondaryInletTemperatureC:
          finalTank
            .nominalSecondaryInletTemperatureC,

        nominalSecondaryOutletTemperatureC:
          finalTank
            .nominalSecondaryOutletTemperatureC,

        actualPrimaryInletTemperatureC:
          finalTank
            .actualPrimaryInletTemperatureC,

        actualPrimaryOutletTemperatureC:
          finalTank
            .actualPrimaryOutletTemperatureC,

        nominalTemperatureDifferenceC:
          finalTank
            .nominalTemperatureDifferenceC,

        lowerZoneTemperatureC:
          finalTank
            .lowerZoneTemperatureC,

        maximumUsefulEnergyKWh:
          finalTank
            .maximumUsefulEnergyKWh,

        heatingTimeHours:
          heating
            .heatingTimeHours,

        heatingTimeMinutes:
          heating
            .heatingTimeMinutes,

        canHeat:
          heating.canHeat,

        generatedEnergyKWh:
          tankTotals
            .generatedEnergyKWh,

        effectiveGenerationMinutes:
          tankTotals
            .effectiveGenerationMinutes,

        effectiveGenerationHours:
          tankTotals
            .effectiveGenerationMinutes /
          60,

        minimumLoadPercent:
          tankTotals
            .minimumLoadPercent,

        maximumLoadPercent:
          tankTotals
            .maximumLoadPercent,

        finalLoadPercent:
          tankTotals
            .finalLoadPercent,

        minimumAverageTemperatureC:
          tankTotals
            .minimumAverageTemperatureC,

        finalAverageTemperatureC:
          tankTotals
            .finalAverageTemperatureC,

        minimumOutletTemperatureC:
          tankTotals
            .minimumOutletTemperatureC,

        finalOutletTemperatureC:
          tankTotals
            .finalOutletTemperatureC
      };
    }
  );
}


/**
 * Calcula la carga energética total del sistema para un estado
 * formado por uno o varios depósitos.
 */
function calculateSystemLoadPercentFromTankStates(
  tankStates
) {
  if (
    !Array.isArray(tankStates) ||
    tankStates.length === 0
  ) {
    return null;
  }

  const storedEnergyKWh =
    sumNumbers(
      tankStates.map(
        tank =>
          finiteOrFallback(
            tank.energyKWh,
            0
          )
      )
    );

  const maximumEnergyKWh =
    sumNumbers(
      tankStates.map(
        tank =>
          finiteOrFallback(
            tank.maximumUsefulEnergyKWh,
            0
          )
      )
    );

  if (
    maximumEnergyKWh <=
    ACS_BLOCK7_CONSTANTS
      .ENERGY_EPSILON_KWH
  ) {
    return null;
  }

  return clamp(
    storedEnergyKWh /
      maximumEnergyKWh *
      100,
    0,
    100
  );
}


/**
 * Obtiene la carga mínima energética del conjunto durante
 * el periodo de análisis.
 *
 * La carga se pondera por la capacidad energética real de
 * cada depósito; no se suman porcentajes ni se toma el peor
 * depósito como carga global.
 */
function calculateSystemMinimumLoad(
  context
) {
  const values =
    context.minutes
      .map(
        minute => ({
          minuteIndex:
            minute.minuteIndex,

          loadPercent:
            calculateSystemLoadPercentFromTankStates(
              minute.finalTankStates
            )
        })
      )
      .filter(
        item =>
          isFiniteNumber(
            item.loadPercent
          )
      );

  if (
    values.length === 0
  ) {
    const fallback =
      calculateSystemLoadPercentFromTankStates(
        context.finalState.tanks
      );

    return {
      loadPercent:
        finiteOrFallback(
          fallback,
          0
        ),

      minuteIndex:
        null
    };
  }

  return values.reduce(
    (
      minimum,
      current
    ) =>
      current.loadPercent <
      minimum.loadPercent
        ? current
        : minimum
  );
}


/* ============================================================
 * RESULTADOS GENERALES
 * ============================================================ */

/**
 * Construye los resultados generales de la UI.
 */
function createGeneralResults(
  context,
  hydraulic,
  tanks
) {
  const energy =
    context.totals.energy;

  const comfort =
    context.totals.comfort;

  const generator =
    context.totals.generator;

  const requestedDemandEnergyKWh =
    energy
      .requestedDemandEnergyKWh;

  const recirculationLossKWh =
    energy
      .recirculationLossKWh;

  const systemMinimumLoad =
    calculateSystemMinimumLoad(
      context
    );

  return {
    periodHours:
      context.totals.hourCount,

    energy: {
      demandKWh:
        requestedDemandEnergyKWh,

      coveredDemandKWh:
        energy
          .coveredDemandEnergyKWh,

      lossesKWh:
        recirculationLossKWh,

      lossesPercentOfDemand:
        energy
          .lossesPercentOfDemand,

      demandPlusLossesKWh:
        requestedDemandEnergyKWh +
        recirculationLossKWh,

      generatedKWh:
        energy
          .generatedEnergyKWh,

      deficitKWh:
        energy
          .uncoveredDemandEnergyKWh,

      initialStoredKWh:
        energy
          .initialStoredEnergyKWh,

      finalStoredKWh:
        energy
          .finalStoredEnergyKWh,

      storageDischargeKWh:
        energy
          .storageDischargeKWh
    },

    comfort: {
      coveragePercent:
        comfort
          .coveragePercent,

      uncoveredEquivalentVolumeL:
        context
          .totals
          .volume
          .uncoveredEquivalentVolumeL,

      minimumUseTemperatureC:
        comfort
          .minimumActualUseTemperatureC,

      minutesBelowTarget:
        comfort
          .minutesBelowTargetTemperature
    },

    generator: {
      runningMinutes:
        generator
          .runningMinutes,

      runningHours:
        generator
          .runningHours,

      starts:
        generator
          .starts,

      stops:
        generator
          .stops
    },

    exchangers:
      tanks.map(
        tank => ({
          tankId:
            tank.tankId,

          type:
            tank.exchangerType,

          typeLabel:
            tank.exchangerTypeLabel,

          nominalPowerKW:
            tank.exchangerPowerKW,

          averageEffectivePowerKW:
            tank.averageEffectivePowerKW,

          averageCorrectionFactor:
            tank.averageCorrectionFactor,

          deratingPercent:
            tank.deratingPercent,

          deratingMinutes:
            tank.deratingMinutes,

          runningMinutes:
            tank
              .effectiveGenerationMinutes,

          runningHours:
            tank
              .effectiveGenerationHours,

          generatedEnergyKWh:
            tank
              .generatedEnergyKWh
        })
      ),

    storage: {
      totalVolumeL:
        sumNumbers(
          tanks.map(
            tank =>
              tank.volumeL
          )
        ),

      totalMaximumUsefulEnergyKWh:
        sumNumbers(
          tanks.map(
            tank =>
              tank
                .maximumUsefulEnergyKWh
          )
        ),

      systemMinimumLoadPercent:
        systemMinimumLoad
          .loadPercent,

      systemMinimumLoadMinuteIndex:
        systemMinimumLoad
          .minuteIndex
    },

    hydraulics:
      cloneObject(hydraulic)
  };
}


/* ============================================================
 * VALORACIÓN SANITARIA
 * ============================================================ */

/**
 * Calcula directamente sobre todos los pasos de minuto del periodo
 * analizado los indicadores usados por las valoraciones.
 *
 * Los resultados horarios se reservan para tablas y resúmenes; no
 * intervienen en la decisión sanitaria ni en la de confort.
 */
function createContinuousAssessmentMetrics(
  context
) {
  const minutes =
    Array.isArray(context.minutes)
      ? context.minutes
      : [];

  if (minutes.length === 0) {
    throw new ACSBlock7Error(
      "Las valoraciones continuas requieren los resultados por minuto del periodo analizado."
    );
  }

  const requestedDemandEnergyKWh =
    sumNumbers(
      minutes.map(
        minute =>
          finiteOrFallback(
            minute.energies
              ?.requestedDemandEnergyKWh,
            0
          )
      )
    );

  const coveredDemandEnergyKWh =
    sumNumbers(
      minutes.map(
        minute =>
          finiteOrFallback(
            minute.energies
              ?.coveredDemandEnergyKWh,
            0
          )
      )
    );

  const uncoveredDemandEnergyKWh =
    sumNumbers(
      minutes.map(
        minute =>
          finiteOrFallback(
            minute.energies
              ?.uncoveredDemandEnergyKWh,
            0
          )
      )
    );

  const uncoveredEquivalentVolumeL =
    sumNumbers(
      minutes.map(
        minute =>
          finiteOrFallback(
            minute.comfort
              ?.uncoveredEquivalentVolumeL,
            0
          )
      )
    );

  const actualUseTemperatures =
    minutes
      .map(
        minute =>
          minute.comfort
            ?.actualUseTemperatureC
      )
      .filter(isFiniteNumber);

  const sanitaryTemperatures =
    minutes
      .map(
        minute =>
          minute.sanitary
            ?.temperatureC
      )
      .filter(isFiniteNumber);

  const sanitaryMinutesBelowThreshold =
    sumNumbers(
      minutes.map(
        minute =>
          finiteOrFallback(
            minute.sanitary
              ?.minutesBelow60C,
            0
          )
      )
    );

  const firstSanitaryMinute =
    minutes.find(
      minute =>
        minute.sanitary
          ?.enabled
    );

  return {
    resolutionMinutes:
      finiteOrFallback(
        context.metadata
          ?.intervalMinutes,
        1
      ),

    evaluatedMinuteCount:
      minutes.length,

    comfort: {
      requestedDemandEnergyKWh,
      coveredDemandEnergyKWh,
      uncoveredDemandEnergyKWh,
      uncoveredEquivalentVolumeL,

      coveragePercent:
        requestedDemandEnergyKWh >
        ACS_BLOCK7_CONSTANTS
          .ENERGY_EPSILON_KWH
          ? clamp(
              coveredDemandEnergyKWh /
                requestedDemandEnergyKWh *
                100,
              0,
              100
            )
          : 100,

      minutesBelowTargetTemperature:
        minutes.filter(
          minute =>
            minute.comfort
              ?.targetTemperatureReached ===
            false
        ).length,

      minimumActualUseTemperatureC:
        minimumNumber(
          actualUseTemperatures,
          null
        )
    },

    sanitary: {
      evaluatedTankId:
        firstSanitaryMinute
          ?.sanitary
          ?.evaluatedTankId ||
        null,

      minutesBelowThreshold:
        sanitaryMinutesBelowThreshold,

      minimumTemperatureC:
        minimumNumber(
          sanitaryTemperatures,
          null
        )
    }
  };
}

/**
 * Crea la valoración sanitaria opcional.
 *
 * Cumple:
 *
 * minutos por debajo de 60 °C <= 30
 */
function createSanitaryAssessment(
  context
) {
  const enabled =
    Boolean(
      context.config
        .sanitaryCheck
    );

  if (!enabled) {
    return {
      enabled: false,

      evaluated: false,

      includeInReport: false,

      status:
        "not-evaluated",

      level:
        "info",

      label:
        "No realizada",

      compliant:
        null,

      evaluatedTankId:
        null,

      thresholdTemperatureC:
        ACS_BLOCK7_CONSTANTS
          .SANITARY_TEMPERATURE_C,

      maximumAllowedMinutesBelowThreshold:
        ACS_BLOCK7_CONSTANTS
          .SANITARY_MAX_MINUTES_BELOW_60_C,

      minutesBelowThreshold:
        null,

      message:
        "La comprobación sanitaria no ha sido solicitada.",

      reportText:
        null
    };
  }

  const continuous =
    createContinuousAssessmentMetrics(
      context
    );

  const sanitary =
    continuous.sanitary;

  const minutesBelowThreshold =
    finiteOrFallback(
      sanitary.minutesBelowThreshold,
      0
    );

  const compliant =
    minutesBelowThreshold <=
    ACS_BLOCK7_CONSTANTS
      .SANITARY_MAX_MINUTES_BELOW_60_C;

  return {
    enabled: true,

    evaluated: true,

    includeInReport: true,

    status:
      compliant
        ? "compliant"
        : "non-compliant",

    level:
      compliant
        ? "success"
        : "danger",

    label:
      compliant
        ? "Cumple"
        : "No cumple",

    compliant,

    evaluatedTankId:
      sanitary
        .evaluatedTankId,

    evaluationResolutionMinutes:
      continuous.resolutionMinutes,

    evaluatedMinuteCount:
      continuous.evaluatedMinuteCount,

    minimumTemperatureC:
      sanitary.minimumTemperatureC,

    thresholdTemperatureC:
      ACS_BLOCK7_CONSTANTS
        .SANITARY_TEMPERATURE_C,

    maximumAllowedMinutesBelowThreshold:
      ACS_BLOCK7_CONSTANTS
        .SANITARY_MAX_MINUTES_BELOW_60_C,

    minutesBelowThreshold,

    message:
      compliant
        ? (
            `La evaluación continua minuto a minuto indica que el depósito de suministro ha permanecido ${formatNumber(
              minutesBelowThreshold,
              0
            )} minutos por debajo de 60 °C, dentro del máximo definido de 30 minutos.`
          )
        : (
            `La evaluación continua minuto a minuto indica que el depósito de suministro ha permanecido ${formatNumber(
              minutesBelowThreshold,
              0
            )} minutos por debajo de 60 °C, superando el máximo definido de 30 minutos.`
          ),

    reportText:
      compliant
        ? (
            `Durante el periodo analizado, correspondiente a las últimas 24 horas de simulación, la temperatura media del depósito de suministro ${sanitary.evaluatedTankId} ha permanecido por debajo de 60 °C durante ${formatNumber(
              minutesBelowThreshold,
              0
            )} minutos. Al no superar el máximo definido de 30 minutos, se considera que cumple el criterio sanitario establecido para esta simulación.`
          )
        : (
            `Durante el periodo analizado, correspondiente a las últimas 24 horas de simulación, la temperatura media del depósito de suministro ${sanitary.evaluatedTankId} ha permanecido por debajo de 60 °C durante ${formatNumber(
              minutesBelowThreshold,
              0
            )} minutos. Al superar el máximo definido de 30 minutos, se considera que no cumple el criterio sanitario establecido para esta simulación.`
          )
  };
}


/* ============================================================
 * VALORACIÓN DE CONFORT
 * ============================================================ */

/**
 * Crea la valoración de confort.
 *
 * Prioridad:
 *
 * 1. Existe déficit:
 *    No cubre la demanda.
 *
 * 2. Sin déficit y carga mínima < 30 %:
 *    Cubre justo.
 *
 * 3. Carga mínima entre 30 % y 60 %:
 *    Cumple.
 *
 * 4. Carga mínima >= 60 %:
 *    Cumple holgado.
 */
function createComfortAssessment(
  context,
  tanks
) {
  const continuous =
    createContinuousAssessmentMetrics(
      context
    );

  const comfort =
    continuous.comfort;

  const deficitKWh =
    finiteOrFallback(
      comfort
        .uncoveredDemandEnergyKWh,
      0
    );

  const hasDeficit =
    deficitKWh >
    ACS_BLOCK7_CONSTANTS
      .ENERGY_EPSILON_KWH;

  /*
   * La valoración de confort se realiza sobre
   * el depósito de suministro:
   *
   * - D1 cuando existe un único depósito.
   * - D2 cuando existen dos depósitos.
   */
  const supplyTankIndex =
    tanks.length >= 2
      ? 1
      : 0;

  const supplyTank =
    tanks[supplyTankIndex];

  if (!supplyTank) {
    throw new ACSBlock7Error(
      "No se ha encontrado el depósito de suministro para la valoración de confort.",
      {
        tankCount:
          context.config.tankCount,

        supplyTankIndex
      }
    );
  }

  const evaluatedTankId =
    supplyTank.tankId;

  const supplyTankMinimumLoadPercent =
    minimumNumber(
      context.minutes.map(
        minute =>
          minute.finalTankStates
            ?.[supplyTankIndex]
            ?.loadPercent
      ),
      finiteOrFallback(
        supplyTank
          .minimumLoadPercent,
        0
      )
    );

  let status;
  let level;
  let label;
  let message;
  let reportText;

  if (hasDeficit) {
    status =
      "uncovered-demand";

    level =
      "danger";

    label =
      "No cubre la demanda";

    message =
      `Existe un déficit energético de ${formatNumber(
        deficitKWh,
        2
      )} kWh. Durante parte del periodo no se ha alcanzado la temperatura de uso definida.`;

    reportText =
      `Durante las últimas 24 horas de simulación, la instalación no ha cubierto completamente la demanda de ACS. El déficit energético no cubierto ha sido de ${formatNumber(
        deficitKWh,
        2
      )} kWh, equivalente a ${formatNumber(
        comfort
          .uncoveredEquivalentVolumeL,
        1
      )} litros de ACS a la temperatura de uso definida.`;

  } else if (
    supplyTankMinimumLoadPercent <
    ACS_BLOCK7_CONSTANTS
      .COMFORT_TIGHT_MAX_PERCENT
  ) {
    status =
      "tight";

    level =
      "warning";

    label =
      "Cubre justo";

    message =
      `La demanda se cubre completamente, pero la carga mínima del depósito de suministro ${evaluatedTankId} ha descendido por debajo del 30 %. Una demanda superior podría provocar falta de cobertura.`;

    reportText =
      `Durante las últimas 24 horas de simulación, la instalación ha cubierto completamente la demanda de ACS. No obstante, la carga mínima registrada en el depósito de suministro ${evaluatedTankId} ha sido del ${formatNumber(
        supplyTankMinimumLoadPercent,
        2
      )} %, por lo que la instalación funciona con un margen reducido y una demanda superior podría provocar periodos sin cobertura completa.`;

  } else if (
    supplyTankMinimumLoadPercent <
    ACS_BLOCK7_CONSTANTS
      .COMFORT_COMPLIANT_MAX_PERCENT
  ) {
    status =
      "compliant";

    level =
      "success";

    label =
      "Cumple";

    message =
      `La demanda se cubre completamente y la carga mínima del depósito de suministro ${evaluatedTankId} se mantiene entre el 30 % y el 60 %.`;

    reportText =
      `Durante las últimas 24 horas de simulación, la instalación ha cubierto completamente la demanda de ACS. La carga mínima registrada en el depósito de suministro ${evaluatedTankId} ha sido del ${formatNumber(
        supplyTankMinimumLoadPercent,
        2
      )} %, por lo que el comportamiento se considera adecuado para el perfil de demanda analizado.`;

  } else {
    status =
      "comfortable";

    level =
      "success";

    label =
      "Cumple holgado";

    message =
      `La demanda se cubre completamente y la carga mínima del depósito de suministro ${evaluatedTankId} se mantiene por encima del 60 %, mostrando un margen holgado.`;

    reportText =
      `Durante las últimas 24 horas de simulación, la instalación ha cubierto completamente la demanda de ACS. La carga mínima registrada en el depósito de suministro ${evaluatedTankId} ha sido del ${formatNumber(
        supplyTankMinimumLoadPercent,
        2
      )} %, por lo que se considera que dispone de un margen holgado frente al perfil de demanda analizado.`;
  }

  return {
    enabled: true,

    evaluated: true,

    includeInReport: true,

    status,

    level,

    label,

    evaluatedTankId,

    evaluationResolutionMinutes:
      continuous.resolutionMinutes,

    evaluatedMinuteCount:
      continuous.evaluatedMinuteCount,

    hasDeficit,

    deficitKWh,

    coveragePercent:
      comfort
        .coveragePercent,

    uncoveredEquivalentVolumeL:
      comfort
        .uncoveredEquivalentVolumeL,

    minutesBelowTargetTemperature:
      comfort
        .minutesBelowTargetTemperature,

    minimumUseTemperatureC:
      comfort
        .minimumActualUseTemperatureC,

    supplyTankMinimumLoadPercent,

    /*
     * Se conserva esta propiedad para mantener
     * compatibilidad con la UI y el informe actuales.
     *
     * Ahora representa la carga mínima del depósito
     * de suministro evaluado.
     */
    systemMinimumLoadPercent:
      supplyTankMinimumLoadPercent,

    tanks:
      tanks.map(
        tank => ({
          tankId:
            tank.tankId,

          minimumLoadPercent:
            tank
              .minimumLoadPercent,

          isSupplyTank:
            tank.tankId ===
            evaluatedTankId
        })
      ),

    message,

    reportText
  };
}


/* ============================================================
 * VALORACIÓN DE PÉRDIDAS
 * ============================================================ */

/**
 * Clasifica las pérdidas por recirculación.
 *
 * < 5 %:
 * bajas.
 *
 * 5 % a 15 %:
 * habituales.
 *
 * > 15 %:
 * altas.
 */
function createLossesAssessment(
  context
) {
  const energy =
    context.totals.energy;

  const lossPercentage =
    finiteOrFallback(
      energy
        .lossesPercentOfDemand,
      0
    );

  const lossEnergyKWh =
    finiteOrFallback(
      energy
        .recirculationLossKWh,
      0
    );

  let status;
  let level;
  let label;
  let message;
  let recommendation;
  let reportText;

  if (
    lossPercentage <
    ACS_BLOCK7_CONSTANTS
      .LOW_LOSSES_MAX_PERCENT
  ) {
    status =
      "low";

    level =
      "success";

    label =
      "Pérdidas bajas";

    message =
      "Las pérdidas por recirculación representan un porcentaje reducido de la demanda energética.";

    recommendation =
      null;

    reportText =
      `Las pérdidas energéticas asociadas a la recirculación representan el ${formatNumber(
        lossPercentage,
        2
      )} % de la demanda energética, considerándose bajas para el periodo analizado.`;

  } else if (
    lossPercentage <=
    ACS_BLOCK7_CONSTANTS
      .USUAL_LOSSES_MAX_PERCENT
  ) {
    status =
      "usual";

    level =
      "warning";

    label =
      "Pérdidas habituales";

    message =
      "Las pérdidas por recirculación se sitúan dentro del rango definido como habitual.";

    recommendation =
      null;

    reportText =
      `Las pérdidas energéticas asociadas a la recirculación representan el ${formatNumber(
        lossPercentage,
        2
      )} % de la demanda energética, situándose dentro del rango definido como habitual.`;

  } else {
    status =
      "high";

    level =
      "danger";

    label =
      "Pérdidas altas";

    message =
      "Las pérdidas por recirculación representan una parte importante de la demanda energética.";

    recommendation =
      "Se recomienda revisar el caudal de recirculación, el aislamiento de las tuberías y el funcionamiento del circuito.";

    reportText =
      `Las pérdidas energéticas asociadas a la recirculación representan el ${formatNumber(
        lossPercentage,
        2
      )} % de la demanda energética. Este valor se considera elevado, por lo que se recomienda revisar el caudal de recirculación, el aislamiento de las tuberías y el funcionamiento del circuito.`;
  }

  return {
    enabled: true,

    evaluated: true,

    includeInReport: true,

    status,

    level,

    label,

    lossPercentage,

    lossEnergyKWh,

    message,

    recommendation,

    reportText
  };
}


/* ============================================================
 * DATOS PARA GRÁFICAS
 * ============================================================ */

/**
 * Crea las series horarias de las últimas 24 horas.
 */
function createChartData(
  context
) {
  const hourly =
    context.hourly;

  const minutes =
    context.minutes;

  const tankCount =
    context.config.tankCount;

  const hours =
    hourly.map(
      (
        hour,
        index
      ) => ({
        index:
          index + 1,

        label:
          `${String(
            index
          ).padStart(
            2,
            "0"
          )}:00`,

        absoluteHourIndex:
          hour.hourIndex
      })
    );

  const deliveredEnergyByTank = {};
  const exchangerPowerByTankKW = {};
  const exchangerMaximumPowerByTankKW = {};
  const averageTemperatureByTank = {};
  const finalLoadByTank = {};
  const continuousLoadByTank = {};

  for (
    let tankIndex = 0;
    tankIndex < tankCount;
    tankIndex += 1
  ) {
    const tankId =
      `D${tankIndex + 1}`;

    deliveredEnergyByTank[
      tankId
    ] =
      hourly.map(
        hour =>
          hour
            .tanks[tankIndex]
            .generatedEnergyKWh
      );

    exchangerPowerByTankKW[
      tankId
    ] =
      minutes.map(
        minute =>
          finiteOrFallback(
            minute
              .generation
              .tankResults[tankIndex]
              ?.effectivePowerKW,
            0
          )
      );

    exchangerMaximumPowerByTankKW[
      tankId
    ] =
      finiteOrFallback(
        context
          .config
          .tanks[tankIndex]
          .exchangerPowerKW,
        0
      );

    averageTemperatureByTank[
      tankId
    ] =
      hourly.map(
        hour =>
          hour
            .tanks[tankIndex]
            .finalAverageTemperatureC
      );

    finalLoadByTank[
      tankId
    ] =
      hourly.map(
        hour =>
          hour
            .tanks[tankIndex]
            .finalLoadPercent
      );

    continuousLoadByTank[
      tankId
    ] =
      minutes.map(
        minute => {
          const finalLoadPercent =
            finiteOrFallback(
              minute
                .finalTankStates[tankIndex]
                ?.loadPercent,
              0
            );

          /*
           * El control puede alcanzar el 100 % y detener el generador
           * dentro del minuto. Después, el consumo y la recirculación
           * del tiempo restante hacen que el estado publicado al final
           * del minuto vuelva a quedar por debajo del 100 %.
           *
           * La gráfica debe conservar ese máximo instantáneo real;
           * de lo contrario parece que el generador se detiene antes de
           * alcanzar Tacum aunque el ciclo interno sea correcto.
           */
          const reachedFullLoadDuringMinute =
            minute.generation
              ?.stoppedDuringMinute === true &&
            finiteOrFallback(
              minute.generation
                ?.tankResults?.[tankIndex]
                ?.effectiveMinutes,
              0
            ) > 0;

          return reachedFullLoadDuringMinute
            ? 100
            : finalLoadPercent;
        }
      );
  }

  const generatorOperatingIntervals =
    Array.isArray(
      context.generatorOperation
        ?.intervals
    )
      ? context.generatorOperation
          .intervals
          .map(
            interval => ({
              ...interval
            })
          )
      : [];

  const generatorPowerSegments =
    Array.isArray(
      context.generatorOperation
        ?.powerSegments
    )
      ? context.generatorOperation
          .powerSegments
          .map(
            segment => ({
              startMinute:
                finiteOrFallback(
                  segment.startMinute,
                  0
                ),

              endMinute:
                finiteOrFallback(
                  segment.endMinute,
                  0
                ),

              totalPowerKW:
                finiteOrFallback(
                  segment.totalPowerKW,
                  0
                ),

              tankPowersKW:
                Array.isArray(
                  segment.tankPowersKW
                )
                  ? segment
                      .tankPowersKW
                      .map(
                        value =>
                          finiteOrFallback(
                            value,
                            0
                          )
                      )
                  : []
            })
          )
      : [];

  /*
   * Serie media por minuto, mantenida por compatibilidad.
   * La gráfica de potencia usa generatorPowerSegments para conservar
   * los cambios continuos de asignación entre intercambiadores.
   */
  const generatorPowerKW =
    minutes.map(
      minute =>
        finiteOrFallback(
          minute
            .generation
            ?.effectivePowerKW,
          finiteOrFallback(
            minute
              .generation
              ?.generatorPowerKW,
            0
          )
        )
    );

  const totalDeliveredEnergyKWh =
    hourly.map(
      (hour, hourIndex) =>
        sumNumbers(
          Object.values(
            deliveredEnergyByTank
          ).map(
            series =>
              finiteOrFallback(
                series[hourIndex],
                0
              )
          )
        )
    );

  return {
    periodHours:
      24,

    minuteCount:
      minutes.length,

    hours,

    energy: {
      generatorPowerKW,

      generatorOperatingIntervals,

      generatorPowerSegments,

      generatorHourlyOperation:
        context.generatorOperation
          ?.hourly || [],

      generatorMaximumPowerKW:
        finiteOrFallback(
          context.config
            .generatorPowerKW,
          0
        ),

      exchangerPowerByTankKW,

      exchangerMaximumPowerByTankKW,

      deliveredEnergyByTank,

      totalDeliveredEnergyKWh,

      units: {
        power:
          "kW",

        deliveredEnergy:
          "kWh"
      }
    },

    temperature: {
      averageTemperatureByTank,

      sanitaryReferenceTemperatureC:
        context.config
          .sanitaryCheck
          ? ACS_BLOCK7_CONSTANTS
              .SANITARY_TEMPERATURE_C
          : null,

      storageReferenceTemperatureC:
        context.config
          .storageTemperatureC,

      unit:
        "°C"
    },

    load: {
      finalLoadByTank,

      continuousLoadByTank,

      tightReferencePercent:
        ACS_BLOCK7_CONSTANTS
          .COMFORT_TIGHT_MAX_PERCENT,

      comfortableReferencePercent:
        ACS_BLOCK7_CONSTANTS
          .COMFORT_COMPLIANT_MAX_PERCENT,

      unit:
        "%"
    }
  };
}



/* ============================================================
 * VALORACIÓN DE INTERCAMBIADORES
 * ============================================================ */

/**
 * Crea una valoración térmica para placas y serpentines.
 */
function createExchangerAssessments(
  tanks
) {
  return tanks
    .map(
      tank => {
        const typeLabel =
          tank.exchangerType === "immersed"
            ? "Serpentín sumergido"
            : "Intercambiador de placas";

        const operationDescription =
          tank.exchangerType === "immersed"
            ? "el calentamiento progresivo de la zona inferior que rodea al serpentín"
            : "el calentamiento progresivo del agua aspirada desde la zona inferior";

        const averageFactor =
          clamp(
            finiteOrFallback(
              tank.averageCorrectionFactor,
              1
            ),
            0,
            1
          );

        const deratingPercent =
          clamp(
            (
              1 -
              averageFactor
            ) *
            100,
            0,
            100
          );

        const hasRelevantDerating =
          deratingPercent >= 1;

        return {
          tankId:
            tank.tankId,

          type:
            tank.exchangerType,

          label:
            typeLabel,

          nominalPowerKW:
            tank.exchangerPowerKW,

          averageEffectivePowerKW:
            tank.averageEffectivePowerKW,

          averageCorrectionFactor:
            averageFactor,

          deratingPercent,

          deratingMinutes:
            tank.deratingMinutes,

          hasRelevantDerating,

          message:
            hasRelevantDerating
              ? (
                  `El ${typeLabel.toLowerCase()} del depósito ${tank.tankId} presenta una potencia disponible media de ${formatNumber(
                    tank.averageEffectivePowerKW,
                    2
                  )} kW frente a ${formatNumber(
                    tank.exchangerPowerKW,
                    2
                  )} kW nominales, lo que supone una reducción media del ${formatNumber(
                    deratingPercent,
                    1
                  )} %. Esta disminución se debe a ${operationDescription} y a las condiciones reales del primario.`
                )
              : (
                  `El ${typeLabel.toLowerCase()} del depósito ${tank.tankId} mantiene durante el periodo una potencia disponible media próxima a su potencia nominal, sin una pérdida de rendimiento relevante.`
                ),

          reportText:
            hasRelevantDerating
              ? (
                  `En el depósito ${tank.tankId}, equipado con ${typeLabel.toLowerCase()}, la potencia nominal declarada es de ${formatNumber(
                    tank.exchangerPowerKW,
                    2
                  )} kW y la potencia disponible media calculada durante las últimas 24 horas es de ${formatNumber(
                    tank.averageEffectivePowerKW,
                    2
                  )} kW. El factor térmico medio es ${formatNumber(
                    averageFactor,
                    3
                  )}, equivalente a una reducción media de potencia del ${formatNumber(
                    deratingPercent,
                    1
                  )} %. La reducción responde al menor salto térmico disponible por ${operationDescription} y a las temperaturas reales de ida y retorno del primario.`
                )
              : (
                  `En el depósito ${tank.tankId}, equipado con ${typeLabel.toLowerCase()}, la potencia disponible media se mantiene próxima a la potencia nominal durante el periodo analizado.`
                )
        };
      }
    );
}


/* ============================================================
 * CONCLUSIONES
 * ============================================================ */

/**
 * Genera conclusiones estructuradas.
 */
function createConclusions(
  assessments,
  heatingTimes,
  exchangerAssessments = []
) {
  const conclusions = [];

  if (
    assessments
      .sanitary
      .enabled
  ) {
    conclusions.push({
      category:
        "sanitary",

      level:
        assessments
          .sanitary
          .level,

      title:
        "Comprobación sanitaria",

      text:
        assessments
          .sanitary
          .message
    });
  }

  conclusions.push({
    category:
      "comfort",

    level:
      assessments
        .comfort
        .level,

    title:
      "Confort",

    text:
      assessments
        .comfort
        .message
  });

  conclusions.push({
    category:
      "losses",

    level:
      assessments
        .losses
        .level,

    title:
      "Pérdidas por recirculación",

    text:
      assessments
        .losses
        .recommendation
        ? (
            `${assessments.losses.message} ${assessments.losses.recommendation}`
          )
        : assessments
            .losses
            .message
  });

  exchangerAssessments.forEach(
    exchanger => {
      conclusions.push({
        category:
          "exchanger",

        level:
          exchanger.hasRelevantDerating
            ? "warning"
            : "info",

        title:
          `Intercambiador ${exchanger.tankId}`,

        text:
          exchanger.message
      });
    }
  );

  conclusions.push({
    category:
      "heating-time",

    level:
      "info",

    title:
      "Tiempo de calentamiento",

    text:
      heatingTimes.note
  });

  return conclusions;
}


/* ============================================================
 * DATOS PARA EL INFORME
 * ============================================================ */

/**
 * Prepara los textos y apartados que utilizará report.js.
 */
function createReportData(
  project,
  context,
  generalResults,
  heatingTimes,
  tanks,
  assessments,
  exchangerAssessments,
  conclusions,
  charts
) {
  return {
    metadata: {
      block7Version:
        ACS_BLOCK7_CONSTANTS
          .VERSION,

      engineVersion:
        context
          .engineResult
          .simulation
          .metadata
          .model,

      createdAt:
        new Date()
          .toISOString(),

      analysisHours:
        24
    },

    project:
      cloneObject(project),

    inputSummary: {
      demand:
        cloneObject(
          context.config
            .demandProfile
        ),

      temperatures: {
        storageTemperatureC:
          context.config
            .storageTemperatureC,

        useTemperatureC:
          context.config
            .useTemperatureC,

        networkTemperatureC:
          context.config
            .networkTemperatureC
      },

      generator: {
        powerKW:
          context.config
            .generatorPowerKW,

        startThresholdPercent:
          context.config
            .startThresholdPercent
      },

      recirculation: {
        flowLPerMinute:
          context.config
            .recirculationFlowLPerMinute
      },

      sanitaryCheck:
        context.config
          .sanitaryCheck,

      tanks:
        context.config
          .tanks
          .map(
            tank => ({
              id:
                tank.id,

              volumeL:
                tank.volumeL,

              exchangerType:
                tank
                  .exchangerType,

              exchangerPowerKW:
                tank
                  .exchangerPowerKW,

              nominalPrimaryInletTemperatureC:
                tank
                  .nominalPrimaryInletTemperatureC,

              nominalPrimaryOutletTemperatureC:
                tank
                  .nominalPrimaryOutletTemperatureC,

              nominalSecondaryInletTemperatureC:
                tank
                  .nominalSecondaryInletTemperatureC,

              nominalSecondaryOutletTemperatureC:
                tank
                  .nominalSecondaryOutletTemperatureC,

              actualPrimaryInletTemperatureC:
                tank
                  .actualPrimaryInletTemperatureC,

              actualPrimaryOutletTemperatureC:
                tank
                  .actualPrimaryOutletTemperatureC
            })
          )
    },

    generalResults:
      cloneObject(
        generalResults
      ),

    tanks:
      cloneObject(tanks),

    heatingTimes:
      cloneObject(
        heatingTimes
      ),

    assessments: {
      sanitary:
        assessments
          .sanitary
          .includeInReport
          ? cloneObject(
              assessments
                .sanitary
            )
          : null,

      comfort:
        cloneObject(
          assessments
            .comfort
        ),

      losses:
        cloneObject(
          assessments
            .losses
        ),

      exchangers:
        cloneObject(
          exchangerAssessments
        )
    },

    conclusions:
      cloneObject(
        conclusions
      ),

    charts:
      cloneObject(charts),

    notes: [
      heatingTimes.note,

      heatingTimes.totalNote,

      "La carga mínima del conjunto se calcula como la relación entre la energía total almacenada y la capacidad energética total de todos los depósitos. No se suman porcentajes individuales.",

      "Los resultados corresponden exclusivamente a las últimas 24 horas de simulación. Las primeras 24 horas se utilizan como periodo de estabilización.",

      "Los resultados obtenidos deben ser revisados y validados por el proyectista."
    ]
  };
}


/* ============================================================
 * ANÁLISIS PRINCIPAL
 * ============================================================ */

/**
 * Crea el modelo completo del bloque 7.
 *
 * Uso:
 *
 * const analysis =
 *   ACSBlock7.createAnalysis({
 *     project,
 *     engineResult
 *   });
 */
function createAnalysis(input) {
  validateAnalysisInput(input);

  const project =
    createProjectInformation(
      input.project
    );

  const context =
    getSimulationContext(
      input.engineResult
    );

  const heatingTimes =
    createHeatingTimeResults(
      context
    );

  const tanks =
    createTankResults(
      context,
      heatingTimes
    );

  const hydraulic =
    createHydraulicResults(
      context
    );

  const generalResults =
    createGeneralResults(
      context,
      hydraulic,
      tanks
    );

  const assessments = {
    sanitary:
      createSanitaryAssessment(
        context
      ),

    comfort:
      createComfortAssessment(
        context,
        tanks
      ),

    losses:
      createLossesAssessment(
        context
      )
  };

  const exchangerAssessments =
    createExchangerAssessments(
      tanks
    );

  const charts =
    createChartData(
      context
    );

  const conclusions =
    createConclusions(
      assessments,
      heatingTimes,
      exchangerAssessments
    );

  const report =
    createReportData(
      project,
      context,
      generalResults,
      heatingTimes,
      tanks,
      assessments,
      exchangerAssessments,
      conclusions,
      charts
    );

  return {
    metadata: {
      model:
        "ACS Analysis Engine",

      version:
        ACS_BLOCK7_CONSTANTS
          .VERSION,

      createdAt:
        new Date()
          .toISOString(),

      analysisHours:
        24,

      engineValidationValid:
        input
          .engineResult
          .validation
          ?.valid ?? null
    },

    project,

    generalResults,

    heatingTimes,

    tanks,

    assessments,

    exchangerAssessments,

    charts,

    conclusions,

    report
  };
}


/* ============================================================
 * RENDERIZADO DE RESULTADOS
 * ============================================================ */

/**
 * Crea una tarjeta de resultado general.
 */
function createResultCardHtml(
  label,
  value,
  description,
  type = ""
) {
  const typeClass =
    type
      ? ` result-card--${type}`
      : "";

  return `
    <article class="result-card${typeClass}">
      <div class="result-card__label">
        ${escapeHtml(label)}
      </div>

      <div class="result-card__value">
        ${escapeHtml(value)}
      </div>

      <p class="result-card__description">
        ${escapeHtml(description)}
      </p>
    </article>
  `;
}


/**
 * Renderiza las tarjetas generales.
 */
function renderGeneralResults(
  analysis
) {
  const container =
    document.getElementById(
      "generalResultsGrid"
    );

  if (!container) {
    return;
  }

  const results =
    analysis.generalResults;

  const energy =
    results.energy;

  const comfort =
    results.comfort;

  const generator =
    results.generator;

  const hydraulics =
    results.hydraulics;

  const cards = [
    createResultCardHtml(
      "Demanda total",
      `${formatNumber(
        energy.demandKWh,
        2
      )} kWh`,
      "Energía solicitada durante las últimas 24 horas."
    ),

    createResultCardHtml(
      "Pérdidas totales",
      `${formatNumber(
        energy.lossesKWh,
        2
      )} kWh`,
      `${formatNumber(
        energy
          .lossesPercentOfDemand,
        2
      )} % de la demanda.`
    ),

    createResultCardHtml(
      "Demanda + pérdidas",
      `${formatNumber(
        energy
          .demandPlusLossesKWh,
        2
      )} kWh`,
      "Necesidad energética total del periodo."
    ),

    createResultCardHtml(
      "Energía generada",
      `${formatNumber(
        energy.generatedKWh,
        2
      )} kWh`,
      "Energía absorbida por los acumuladores."
    ),

    createResultCardHtml(
      "Déficit energético",
      `${formatNumber(
        energy.deficitKWh,
        2
      )} kWh`,
      "Demanda energética no cubierta.",
      energy.deficitKWh >
      ACS_BLOCK7_CONSTANTS
        .ENERGY_EPSILON_KWH
        ? "danger"
        : "success"
    ),

    createResultCardHtml(
      "Cobertura",
      `${formatNumber(
        comfort.coveragePercent,
        2
      )} %`,
      "Porcentaje energético cubierto.",
      comfort.coveragePercent >=
      100 -
      ACS_BLOCK7_CONSTANTS
        .ENERGY_EPSILON_KWH
        ? "success"
        : "danger"
    ),

    createResultCardHtml(
      "Generador",
      `${formatNumber(
        generator.runningHours,
        2
      )} h`,
      `${formatNumber(
        generator.starts,
        0
      )} arranques durante el periodo.`
    ),

    createResultCardHtml(
      "Caudal máximo de uso",
      `${formatNumber(
        hydraulics
          .maximumUseFlowLPerMinute,
        2
      )} L/min`,
      "Caudal equivalente a la temperatura de uso."
    ),

    createResultCardHtml(
      "Caudal total de retorno",
      `${formatNumber(
        hydraulics
          .totalReturnFlowLPerMinute,
        2
      )} L/min`,
      "Caudal total configurado en el circuito."
    ),

    createResultCardHtml(
      "Retorno por depósitos",
      `${formatNumber(
        hydraulics
          .averageTankReturnFlowLPerMinute,
        2
      )} L/min`,
      `Media. Máximo: ${formatNumber(
        hydraulics
          .maximumTankReturnFlowLPerMinute,
        2
      )} L/min.`
    )
  ];

  results.exchangers.forEach(
    exchanger => {
      cards.push(
        createResultCardHtml(
          `Intercambiador ${exchanger.tankId}`,
          `${formatNumber(
            exchanger.averageEffectivePowerKW,
            2
          )} kW`,

          `${formatNumber(
            exchanger.nominalPowerKW,
            2
          )} kW nominales · reducción media ${formatNumber(
            exchanger.deratingPercent,
            1
          )} % · ${formatNumber(
            exchanger.generatedEnergyKWh,
            2
          )} kWh generados.`
        )
      );
    }
  );

  container.innerHTML =
    cards.join("");
}


/**
 * Renderiza la tabla de acumuladores.
 */
function renderTankResults(
  analysis
) {
  const body =
    document.getElementById(
      "tankResultsTableBody"
    );

  if (!body) {
    return;
  }

  const tankRows =
    analysis.tanks.map(
      tank => `
        <tr>
          <td>
            ${escapeHtml(
              tank.tankId
            )}
            <br>
            <small>
              ${escapeHtml(
                tank.exchangerTypeLabel
              )}
            </small>
          </td>

          <td>
            ${formatNumber(
              tank.volumeL,
              0
            )} L
          </td>

          <td>
            ${formatNumber(
              tank
                .exchangerPowerKW,
              2
            )} kW
          </td>

          <td>
            ${formatNumber(
              tank
                .averageEffectivePowerKW,
              2
            )} kW
          </td>

          <td>
            ${formatNumber(
              tank
                .maximumUsefulEnergyKWh,
              2
            )} kWh
          </td>

          <td>
            ${escapeHtml(
              formatDurationMinutes(
                tank
                  .heatingTimeMinutes
              )
            )}
          </td>

          <td>
            ${formatNumber(
              tank
                .minimumLoadPercent,
              2
            )} %
          </td>

          <td>
            ${formatNumber(
              tank
                .effectiveGenerationHours,
              2
            )} h
          </td>
        </tr>
      `
    );

  const total =
    analysis
      .heatingTimes
      .total;

  const minimumLoad =
    analysis
      .generalResults
      .storage
      .systemMinimumLoadPercent;

  const totalNominalPowerKW =
    sumNumbers(
      analysis.tanks.map(
        tank =>
          tank.exchangerPowerKW
      )
    );

  const totalAverageEffectivePowerKW =
    sumNumbers(
      analysis.tanks.map(
        tank =>
          tank.averageEffectivePowerKW
      )
    );

  tankRows.push(`
    <tr class="result-table__total">
      <td>
        Total
      </td>

      <td>
        ${formatNumber(
          total.volumeL,
          0
        )} L
      </td>

      <td>
        ${formatNumber(
          totalNominalPowerKW,
          2
        )} kW
      </td>

      <td>
        ${formatNumber(
          totalAverageEffectivePowerKW,
          2
        )} kW
      </td>

      <td>
        ${formatNumber(
          total
            .maximumUsefulEnergyKWh,
          2
        )} kWh
      </td>

      <td>
        ${escapeHtml(
          formatDurationMinutes(
            total
              .heatingTimeMinutes
          )
        )}
      </td>

      <td>
        ${formatNumber(
          minimumLoad,
          2
        )} %
      </td>

      <td>
        —
      </td>
    </tr>
  `);

  body.innerHTML =
    tankRows.join("");
}


/**
 * Convierte el nivel de valoración en una clase CSS.
 */
function getAssessmentClass(
  level
) {
  const classes = {
    success:
      "assessment-card--success",

    warning:
      "assessment-card--warning",

    danger:
      "assessment-card--danger",

    info:
      "assessment-card--info"
  };

  return (
    classes[level] ||
    "assessment-card--info"
  );
}


/**
 * Renderiza una tarjeta de valoración.
 */
function renderAssessmentCard(
  elementId,
  title,
  assessment,
  detailsHtml = ""
) {
  const element =
    document.getElementById(
      elementId
    );

  if (!element) {
    return;
  }

  element.className =
    `assessment-card ${getAssessmentClass(
      assessment.level
    )}`;

  element.innerHTML = `
    <h4>
      ${escapeHtml(title)}
    </h4>

    <p class="assessment-card__status">
      ${escapeHtml(
        assessment.label
      )}
    </p>

    <p class="assessment-card__message">
      ${escapeHtml(
        assessment.message
      )}
    </p>

    ${
      detailsHtml
        ? (
            `<div class="assessment-card__details">
              ${detailsHtml}
            </div>`
          )
        : ""
    }
  `;
}


/**
 * Renderiza las tres valoraciones.
 */
function renderAssessments(
  analysis
) {
  const sanitary =
    analysis
      .assessments
      .sanitary;

  const sanitaryElement =
    document.getElementById(
      "sanitaryAssessmentCard"
    );

  if (sanitaryElement) {
    sanitaryElement.hidden =
      !sanitary.enabled;
  }

  if (sanitary.enabled) {
    renderAssessmentCard(
      "sanitaryAssessmentCard",

      "Comprobación sanitaria",

      sanitary,

      `
        <strong>Depósito evaluado:</strong>
        ${escapeHtml(
          sanitary.evaluatedTankId
        )}
        <br>

        <strong>Tiempo bajo 60 °C:</strong>
        ${formatNumber(
          sanitary
            .minutesBelowThreshold,
          0
        )} min
      `
    );
  }

  const comfort =
    analysis
      .assessments
      .comfort;

  const tankMinimums =
    comfort.tanks
      .map(
        tank =>
          `<strong>${escapeHtml(
            tank.tankId
          )}:</strong> ${formatNumber(
            tank
              .minimumLoadPercent,
            2
          )} %`
      )
      .join("<br>");

  renderAssessmentCard(
    "comfortAssessmentCard",

    "Confort",

    comfort,

    `
      ${tankMinimums}
      <br>

      <strong>
  Carga mínima del depósito de suministro
  ${escapeHtml(
    comfort.evaluatedTankId
  )}:
</strong>
      ${formatNumber(
        comfort
          .systemMinimumLoadPercent,
        2
      )} %
      <br>

      <strong>Déficit:</strong>
      ${formatNumber(
        comfort.deficitKWh,
        2
      )} kWh
    `
  );

  const losses =
    analysis
      .assessments
      .losses;

  renderAssessmentCard(
    "lossesAssessmentCard",

    "Pérdidas por recirculación",

    losses,

    `
      <strong>Pérdidas:</strong>
      ${formatNumber(
        losses.lossEnergyKWh,
        2
      )} kWh
      <br>

      <strong>Porcentaje:</strong>
      ${formatNumber(
        losses.lossPercentage,
        2
      )} %

      ${
        losses.recommendation
          ? (
              `<br><br>${escapeHtml(
                losses.recommendation
              )}`
            )
          : ""
      }
    `
  );
}


/**
 * Renderiza las conclusiones.
 */
function renderConclusions(
  analysis
) {
  const container =
    document.getElementById(
      "conclusionsContainer"
    );

  if (!container) {
    return;
  }

  const items =
    analysis.conclusions.map(
      conclusion => `
        <li>
          <strong>
            ${escapeHtml(
              conclusion.title
            )}:
          </strong>

          ${escapeHtml(
            conclusion.text
          )}
        </li>
      `
    );

  container.innerHTML = `
    <ul>
      ${items.join("")}
    </ul>
  `;
}


/**
 * Solicita el renderizado inicial de las gráficas.
 */
function renderInitialChart(
  analysis
) {
  if (
    window.ACSCharts &&
    typeof window
      .ACSCharts
      .renderAll ===
      "function"
  ) {
    window
      .ACSCharts
      .renderAll(
        analysis.charts
      );
  }
}


/**
 * Renderiza todo el análisis en la pantalla 3.
 *
 * Esta función es llamada desde app.js.
 */
function renderAnalysis(
  analysis
) {
  if (
    !analysis ||
    typeof analysis !== "object"
  ) {
    throw new ACSBlock7Error(
      "analysis es obligatorio para renderizar los resultados."
    );
  }

  renderGeneralResults(
    analysis
  );

  renderTankResults(
    analysis
  );

  renderAssessments(
    analysis
  );

  renderConclusions(
    analysis
  );

  renderInitialChart(
    analysis
  );
}


/* ============================================================
 * API PÚBLICA
 * ============================================================ */

const ACSBlock7 =
  Object.freeze({
    version:
      ACS_BLOCK7_CONSTANTS
        .VERSION,

    constants:
      ACS_BLOCK7_CONSTANTS,

    createAnalysis,

    createGeneralResults,

    createHeatingTimeResults,

    calculateSystemHeatingTime,

    calculateSystemLoadPercentFromTankStates,

    calculateSystemMinimumLoad,

    createSanitaryAssessment,

    createComfortAssessment,

    createLossesAssessment,

    createExchangerAssessments,

    createChartData,

    createConclusions,

    createReportData,

    renderAnalysis,

    formatDurationMinutes
  });


/* ============================================================
 * EXPORTACIÓN EN NAVEGADOR
 * ============================================================ */

if (
  typeof window !==
  "undefined"
) {
  window.ACSBlock7 =
    ACSBlock7;

  /*
   * app.js busca esta función después de ejecutar
   * el motor.
   */
  window.ACSAppRenderAnalysis =
    renderAnalysis;
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
    ACSBlock7,

    ACSBlock7Error,

    ACS_BLOCK7_CONSTANTS
  };
}