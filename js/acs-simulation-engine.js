"use strict";

/**
 * ============================================================
 * BLOQUE 1
 * Constantes, configuración, perfiles de demanda y depósito
 * ============================================================
 *
 * Unidades:
 * - Volumen: litros
 * - Temperatura: °C
 * - Energía: kWh
 * - Potencia: kW
 * - Tiempo: minutos
 */

const ACS_CONSTANTS = Object.freeze({
  WATER_KWH_PER_LITRE_K: 4.186 / 3600,

  MINUTES_PER_HOUR: 60,
  HOURS_PER_DAY: 24,
  SIMULATION_HOURS: 48,
  STABILIZATION_HOURS: 24,

  MIN_LOAD_PERCENT: 0,
  MAX_LOAD_PERCENT: 100,

  FULL_OUTLET_TEMPERATURE_LIMIT_PERCENT: 30,

  /**
   * Salto térmico nominal de diseño del anillo de recirculación.
   * Se usa para convertir las pérdidas objetivo en caudal equivalente.
   */
  RECIRCULATION_DESIGN_DELTA_T_C: 1.5,

  /**
   * El serpentín se considera situado en el tercio inferior.
   *
   * Hasta que la carga global supera 2/3, el modelo considera
   * que la zona ocupada por el serpentín permanece a Tred.
   */
  IMMERSED_EXCHANGER_LOWER_ZONE_FRACTION: 1 / 3,

  /**
   * Límite superior de la corrección térmica.
   *
   * En esta primera versión la potencia efectiva nunca puede
   * superar la potencia nominal declarada por el fabricante.
   */
  IMMERSED_EXCHANGER_MAX_CORRECTION_FACTOR: 1,

  DEFAULT_CONVERGENCE_TOLERANCE: 1e-9,
  DEFAULT_MAX_ITERATIONS: 100
});

const ACS_EXCHANGER_TYPES = Object.freeze({
  PLATE: "plate",
  IMMERSED: "immersed"
});

/**
 * Perfiles de reparto de la demanda dentro de cada hora.
 *
 * Cada perfil devuelve 60 pesos cuya suma es 1.
 * El volumen horario total no cambia; únicamente cambia
 * su concentración temporal dentro de la hora.
 */
const ACS_INTRAHOUR_DEMAND_PROFILE_TYPES =
  Object.freeze({
    UNIFORM:
      "uniform",

    FRONT_LOADED_30:
      "front-loaded-30",

    CENTERED_30:
      "centered-30",

    BACK_LOADED_30:
      "back-loaded-30",

    FRONT_LOADED_15:
      "front-loaded-15",

    CENTERED_15:
      "centered-15",

    DOUBLE_PEAK:
      "double-peak"
  });

const ACS_INTRAHOUR_DEMAND_PROFILE_LABELS =
  Object.freeze({
    "uniform":
      "Uniforme durante la hora",

    "front-loaded-30":
      "Concentrado al inicio — 30 min",

    "centered-30":
      "Concentrado al centro — 30 min",

    "back-loaded-30":
      "Concentrado al final — 30 min",

    "front-loaded-15":
      "Pico intenso al inicio — 15 min",

    "centered-15":
      "Pico intenso al centro — 15 min",

    "double-peak":
      "Doble pico"
  });

/**
 * Error específico del motor ACS.
 */
class ACSSimulationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "ACSSimulationError";
    this.details = details;
  }
}

/**
 * Limita un número entre un mínimo y un máximo.
 */
function clamp(value, minimum, maximum) {
  return Math.min(
    maximum,
    Math.max(minimum, value)
  );
}

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
 * Exige que un valor sea un número finito.
 */
function requireFiniteNumber(value, name) {
  if (!isFiniteNumber(value)) {
    throw new ACSSimulationError(
      `${name} debe ser un número finito.`,
      { name, value }
    );
  }

  return value;
}

/**
 * Exige que un valor sea estrictamente positivo.
 */
function requirePositiveNumber(value, name) {
  requireFiniteNumber(value, name);

  if (value <= 0) {
    throw new ACSSimulationError(
      `${name} debe ser mayor que cero.`,
      { name, value }
    );
  }

  return value;
}

/**
 * Exige que un valor sea mayor o igual que cero.
 */
function requireNonNegativeNumber(
  value,
  name
) {
  requireFiniteNumber(value, name);

  if (value < 0) {
    throw new ACSSimulationError(
      `${name} no puede ser negativo.`,
      { name, value }
    );
  }

  return value;
}

/**
 * Exige que un valor esté dentro de un intervalo cerrado.
 */
function requireNumberInRange(
  value,
  minimum,
  maximum,
  name
) {
  requireFiniteNumber(value, name);

  if (
    value < minimum ||
    value > maximum
  ) {
    throw new ACSSimulationError(
      `${name} debe estar entre ${minimum} y ${maximum}.`,
      {
        name,
        value,
        minimum,
        maximum
      }
    );
  }

  return value;
}

/**
 * Normaliza el tipo de intercambiador.
 *
 * Compatibilidad:
 * - Si no se indica, se utiliza "plate".
 * - Se admiten algunos alias habituales.
 */
function normalizeExchangerType(
  value,
  name = "exchangerType"
) {
  const normalized =
    String(
      value === undefined ||
      value === null
        ? ACS_EXCHANGER_TYPES.PLATE
        : value
    )
      .trim()
      .toLowerCase();

  const aliases = {
    plate: ACS_EXCHANGER_TYPES.PLATE,
    plates: ACS_EXCHANGER_TYPES.PLATE,
    placas: ACS_EXCHANGER_TYPES.PLATE,
    external: ACS_EXCHANGER_TYPES.PLATE,
    exterior: ACS_EXCHANGER_TYPES.PLATE,

    immersed: ACS_EXCHANGER_TYPES.IMMERSED,
    submerged: ACS_EXCHANGER_TYPES.IMMERSED,
    coil: ACS_EXCHANGER_TYPES.IMMERSED,
    serpentín: ACS_EXCHANGER_TYPES.IMMERSED,
    serpentin: ACS_EXCHANGER_TYPES.IMMERSED,
    sumergido: ACS_EXCHANGER_TYPES.IMMERSED
  };

  const exchangerType =
    aliases[normalized];

  if (!exchangerType) {
    throw new ACSSimulationError(
      `${name} debe ser "plate" o "immersed".`,
      {
        name,
        value,
        allowedValues: [
          ACS_EXCHANGER_TYPES.PLATE,
          ACS_EXCHANGER_TYPES.IMMERSED
        ]
      }
    );
  }

  return exchangerType;
}

/**
 * Convierte potencia aplicada durante unos minutos en energía.
 */
function powerToEnergy(
  powerKW,
  minutes
) {
  requireNonNegativeNumber(
    powerKW,
    "powerKW"
  );

  requireNonNegativeNumber(
    minutes,
    "minutes"
  );

  return (
    powerKW *
    minutes /
    ACS_CONSTANTS.MINUTES_PER_HOUR
  );
}

/**
 * Energía transportada por un volumen de agua debido a un salto térmico.
 */
function waterEnergyFromDeltaTemperature(
  volumeL,
  deltaTemperatureC
) {
  requireNonNegativeNumber(
    volumeL,
    "volumeL"
  );

  requireFiniteNumber(
    deltaTemperatureC,
    "deltaTemperatureC"
  );

  return (
    volumeL *
    ACS_CONSTANTS.WATER_KWH_PER_LITRE_K *
    deltaTemperatureC
  );
}

/**
 * Energía transportada por un volumen de agua respecto a Tred.
 */
function waterEnergyRelativeToNetwork(
  volumeL,
  waterTemperatureC,
  networkTemperatureC
) {
  return waterEnergyFromDeltaTemperature(
    volumeL,
    waterTemperatureC -
      networkTemperatureC
  );
}

/**
 * Volumen equivalente asociado a una energía y un salto térmico.
 */
function equivalentVolumeFromEnergy(
  energyKWh,
  deltaTemperatureC
) {
  requireNonNegativeNumber(
    energyKWh,
    "energyKWh"
  );

  requirePositiveNumber(
    deltaTemperatureC,
    "deltaTemperatureC"
  );

  return (
    energyKWh /
    (
      ACS_CONSTANTS.WATER_KWH_PER_LITRE_K *
      deltaTemperatureC
    )
  );
}

/**
 * Copia profunda simple para datos serializables.
 */
function cloneObject(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

/**
 * Valida y normaliza los datos específicos del intercambiador.
 *
 * Para placas no se necesitan temperaturas adicionales.
 *
 * Para serpentín se define:
 * - potencia nominal;
 * - primario nominal;
 * - secundario nominal;
 * - primario real.
 */
function normalizeTankExchangerConfig(
  config,
  namePrefix
) {
  const exchangerType =
    normalizeExchangerType(
      config.exchangerType,
      `${namePrefix}.exchangerType`
    );

  const exchangerPowerKW =
    requireNonNegativeNumber(
      config.exchangerPowerKW,
      `${namePrefix}.exchangerPowerKW`
    );

  if (
    exchangerType ===
    ACS_EXCHANGER_TYPES.PLATE
  ) {
    return {
      exchangerType,
      exchangerPowerKW,

      nominalPrimaryInletTemperatureC:
        null,

      nominalPrimaryOutletTemperatureC:
        null,

      nominalSecondaryInletTemperatureC:
        null,

      nominalSecondaryOutletTemperatureC:
        null,

      actualPrimaryInletTemperatureC:
        null,

      actualPrimaryOutletTemperatureC:
        null
    };
  }

  const nominalPrimaryInletTemperatureC =
    requireFiniteNumber(
      config
        .nominalPrimaryInletTemperatureC,
      `${namePrefix}.nominalPrimaryInletTemperatureC`
    );

  const nominalPrimaryOutletTemperatureC =
    requireFiniteNumber(
      config
        .nominalPrimaryOutletTemperatureC,
      `${namePrefix}.nominalPrimaryOutletTemperatureC`
    );

  const nominalSecondaryInletTemperatureC =
    requireFiniteNumber(
      config
        .nominalSecondaryInletTemperatureC,
      `${namePrefix}.nominalSecondaryInletTemperatureC`
    );

  const nominalSecondaryOutletTemperatureC =
    requireFiniteNumber(
      config
        .nominalSecondaryOutletTemperatureC,
      `${namePrefix}.nominalSecondaryOutletTemperatureC`
    );

  const actualPrimaryInletTemperatureC =
    requireFiniteNumber(
      config
        .actualPrimaryInletTemperatureC,
      `${namePrefix}.actualPrimaryInletTemperatureC`
    );

  const actualPrimaryOutletTemperatureC =
    requireFiniteNumber(
      config
        .actualPrimaryOutletTemperatureC,
      `${namePrefix}.actualPrimaryOutletTemperatureC`
    );

  if (
    nominalPrimaryInletTemperatureC <=
    nominalPrimaryOutletTemperatureC
  ) {
    throw new ACSSimulationError(
      `${namePrefix}: la ida nominal del primario debe ser mayor que el retorno nominal.`,
      {
        nominalPrimaryInletTemperatureC,
        nominalPrimaryOutletTemperatureC
      }
    );
  }

  if (
    nominalSecondaryOutletTemperatureC <=
    nominalSecondaryInletTemperatureC
  ) {
    throw new ACSSimulationError(
      `${namePrefix}: la temperatura final nominal del secundario debe ser mayor que la inicial nominal.`,
      {
        nominalSecondaryInletTemperatureC,
        nominalSecondaryOutletTemperatureC
      }
    );
  }

  if (
    actualPrimaryInletTemperatureC <=
    actualPrimaryOutletTemperatureC
  ) {
    throw new ACSSimulationError(
      `${namePrefix}: la ida real del primario debe ser mayor que el retorno real.`,
      {
        actualPrimaryInletTemperatureC,
        actualPrimaryOutletTemperatureC
      }
    );
  }

  const nominalPrimaryMeanTemperatureC =
    (
      nominalPrimaryInletTemperatureC +
      nominalPrimaryOutletTemperatureC
    ) / 2;

  const nominalSecondaryMeanTemperatureC =
    (
      nominalSecondaryInletTemperatureC +
      nominalSecondaryOutletTemperatureC
    ) / 2;

  if (
    nominalPrimaryMeanTemperatureC <=
    nominalSecondaryMeanTemperatureC
  ) {
    throw new ACSSimulationError(
      `${namePrefix}: la temperatura media nominal del primario debe ser mayor que la temperatura media nominal del secundario.`,
      {
        nominalPrimaryMeanTemperatureC,
        nominalSecondaryMeanTemperatureC
      }
    );
  }

  return {
    exchangerType,
    exchangerPowerKW,

    nominalPrimaryInletTemperatureC,
    nominalPrimaryOutletTemperatureC,

    nominalSecondaryInletTemperatureC,
    nominalSecondaryOutletTemperatureC,

    actualPrimaryInletTemperatureC,
    actualPrimaryOutletTemperatureC
  };
}

/**
 * Modelo energético de un depósito.
 */
class ACSTank {
  /**
   * @param {object} config
   * @param {string} config.id
   * @param {number} config.volumeL
   * @param {number} config.exchangerPowerKW
   * @param {"plate"|"immersed"} [config.exchangerType="plate"]
   * @param {number} config.storageTemperatureC
   * @param {number} config.networkTemperatureC
   * @param {number} [config.initialLoadPercent=100]
   *
   * Solo para "immersed":
   * @param {number} config.nominalPrimaryInletTemperatureC
   * @param {number} config.nominalPrimaryOutletTemperatureC
   * @param {number} config.nominalSecondaryInletTemperatureC
   * @param {number} config.nominalSecondaryOutletTemperatureC
   * @param {number} config.actualPrimaryInletTemperatureC
   * @param {number} config.actualPrimaryOutletTemperatureC
   */
  constructor(config) {
    if (
      !config ||
      typeof config !== "object"
    ) {
      throw new ACSSimulationError(
        "La configuración del depósito es obligatoria."
      );
    }

    this.id =
      String(config.id || "D1");

    this.volumeL =
      requirePositiveNumber(
        config.volumeL,
        `${this.id}.volumeL`
      );

    this.storageTemperatureC =
      requireFiniteNumber(
        config.storageTemperatureC,
        `${this.id}.storageTemperatureC`
      );

    this.networkTemperatureC =
      requireFiniteNumber(
        config.networkTemperatureC,
        `${this.id}.networkTemperatureC`
      );

    if (
      this.storageTemperatureC <=
      this.networkTemperatureC
    ) {
      throw new ACSSimulationError(
        `${this.id}: Tacum debe ser mayor que Tred.`,
        {
          storageTemperatureC:
            this.storageTemperatureC,

          networkTemperatureC:
            this.networkTemperatureC
        }
      );
    }

    const exchangerConfig =
      normalizeTankExchangerConfig(
        config,
        this.id
      );

    this.exchangerType =
      exchangerConfig.exchangerType;

    this.exchangerPowerKW =
      exchangerConfig.exchangerPowerKW;

    this.nominalPrimaryInletTemperatureC =
      exchangerConfig
        .nominalPrimaryInletTemperatureC;

    this.nominalPrimaryOutletTemperatureC =
      exchangerConfig
        .nominalPrimaryOutletTemperatureC;

    this.nominalSecondaryInletTemperatureC =
      exchangerConfig
        .nominalSecondaryInletTemperatureC;

    this.nominalSecondaryOutletTemperatureC =
      exchangerConfig
        .nominalSecondaryOutletTemperatureC;

    this.actualPrimaryInletTemperatureC =
      exchangerConfig
        .actualPrimaryInletTemperatureC;

    this.actualPrimaryOutletTemperatureC =
      exchangerConfig
        .actualPrimaryOutletTemperatureC;

    const initialLoadPercent =
      config.initialLoadPercent === undefined
        ? 100
        : requireNumberInRange(
            config.initialLoadPercent,
            ACS_CONSTANTS.MIN_LOAD_PERCENT,
            ACS_CONSTANTS.MAX_LOAD_PERCENT,
            `${this.id}.initialLoadPercent`
          );

    this.maximumUsefulEnergyKWh =
      waterEnergyRelativeToNetwork(
        this.volumeL,
        this.storageTemperatureC,
        this.networkTemperatureC
      );

    this.energyKWh =
      this.maximumUsefulEnergyKWh *
      initialLoadPercent /
      100;

    this.normalizeState();
  }

  /**
   * Crea una copia independiente del depósito.
   */
  clone() {
    return new ACSTank({
      id: this.id,
      volumeL: this.volumeL,

      exchangerType:
        this.exchangerType,

      exchangerPowerKW:
        this.exchangerPowerKW,

      nominalPrimaryInletTemperatureC:
        this.nominalPrimaryInletTemperatureC,

      nominalPrimaryOutletTemperatureC:
        this.nominalPrimaryOutletTemperatureC,

      nominalSecondaryInletTemperatureC:
        this.nominalSecondaryInletTemperatureC,

      nominalSecondaryOutletTemperatureC:
        this.nominalSecondaryOutletTemperatureC,

      actualPrimaryInletTemperatureC:
        this.actualPrimaryInletTemperatureC,

      actualPrimaryOutletTemperatureC:
        this.actualPrimaryOutletTemperatureC,

      storageTemperatureC:
        this.storageTemperatureC,

      networkTemperatureC:
        this.networkTemperatureC,

      initialLoadPercent:
        this.loadPercent
    });
  }

  /**
   * Porcentaje de carga global del depósito.
   */
  get loadPercent() {
    if (
      this.maximumUsefulEnergyKWh <= 0
    ) {
      return 0;
    }

    return clamp(
      100 *
        this.energyKWh /
        this.maximumUsefulEnergyKWh,

      ACS_CONSTANTS.MIN_LOAD_PERCENT,
      ACS_CONSTANTS.MAX_LOAD_PERCENT
    );
  }

  /**
   * Fracción de carga global entre 0 y 1.
   */
  get loadFraction() {
    return this.loadPercent / 100;
  }

  /**
   * Temperatura media equivalente del depósito.
   */
  get averageTemperatureC() {
    return (
      this.networkTemperatureC +
      (
        this.storageTemperatureC -
        this.networkTemperatureC
      ) *
      this.loadFraction
    );
  }

  /**
   * Temperatura de salida según la curva acordada.
   */
  get outletTemperatureC() {
    const load =
      this.loadPercent;

    const limit =
      ACS_CONSTANTS
        .FULL_OUTLET_TEMPERATURE_LIMIT_PERCENT;

    if (load >= limit) {
      return this.storageTemperatureC;
    }

    if (load <= 0) {
      return this.networkTemperatureC;
    }

    const fraction =
      load / limit;

    return clamp(
      this.networkTemperatureC +
        (
          this.storageTemperatureC -
          this.networkTemperatureC
        ) *
        fraction,

      this.networkTemperatureC,
      this.storageTemperatureC
    );
  }

  /**
   * Carga térmica simplificada de la zona inferior.
   *
   * Serpentín en el tercio inferior:
   *
   * Cinf = clamp(3 · Cglobal - 2, 0, 1)
   */
  get lowerZoneLoadFraction() {
    return clamp(
      3 * this.loadFraction - 2,
      0,
      1
    );
  }

  get lowerZoneLoadPercent() {
    return (
      this.lowerZoneLoadFraction *
      100
    );
  }

  /**
   * Temperatura estimada del agua que rodea al serpentín.
   *
   * Tinf =
   * Tred + Cinf · (Tacum - Tred)
   */
  get lowerZoneTemperatureC() {
    return (
      this.networkTemperatureC +
      this.lowerZoneLoadFraction *
      (
        this.storageTemperatureC -
        this.networkTemperatureC
      )
    );
  }

  /**
   * Temperatura media nominal del primario.
   */
  get nominalPrimaryMeanTemperatureC() {
    if (
      this.exchangerType !==
      ACS_EXCHANGER_TYPES.IMMERSED
    ) {
      return null;
    }

    return (
      this.nominalPrimaryInletTemperatureC +
      this.nominalPrimaryOutletTemperatureC
    ) / 2;
  }

  /**
   * Temperatura media nominal del secundario.
   */
  get nominalSecondaryMeanTemperatureC() {
    if (
      this.exchangerType !==
      ACS_EXCHANGER_TYPES.IMMERSED
    ) {
      return null;
    }

    return (
      this.nominalSecondaryInletTemperatureC +
      this.nominalSecondaryOutletTemperatureC
    ) / 2;
  }

  /**
   * Salto térmico nominal simplificado que define la potencia
   * declarada por el fabricante.
   */
  get nominalTemperatureDifferenceC() {
    if (
      this.exchangerType !==
      ACS_EXCHANGER_TYPES.IMMERSED
    ) {
      return null;
    }

    return (
      this.nominalPrimaryMeanTemperatureC -
      this.nominalSecondaryMeanTemperatureC
    );
  }

  /**
   * Temperatura media real del primario.
   */
  get actualPrimaryMeanTemperatureC() {
    if (
      this.exchangerType !==
      ACS_EXCHANGER_TYPES.IMMERSED
    ) {
      return null;
    }

    return (
      this.actualPrimaryInletTemperatureC +
      this.actualPrimaryOutletTemperatureC
    ) / 2;
  }

  /**
   * Salto térmico real simplificado entre el primario y la zona
   * del depósito ocupada por el serpentín.
   */
  get actualTemperatureDifferenceC() {
    if (
      this.exchangerType !==
      ACS_EXCHANGER_TYPES.IMMERSED
    ) {
      return null;
    }

    return Math.max(
      0,
      this.actualPrimaryMeanTemperatureC -
        this.lowerZoneTemperatureC
    );
  }

  /**
   * Factor de corrección térmica.
   *
   * Para placas:
   * factor = 1
   *
   * Para serpentín:
   * factor =
   * clamp(ΔTreal / ΔTnom, 0, 1)
   */
  get thermalCorrectionFactor() {
    if (
      this.exchangerType ===
      ACS_EXCHANGER_TYPES.PLATE
    ) {
      return 1;
    }

    const nominalDifference =
      this.nominalTemperatureDifferenceC;

    if (
      !isFiniteNumber(
        nominalDifference
      ) ||
      nominalDifference <= 0
    ) {
      return 0;
    }

    return clamp(
      this.actualTemperatureDifferenceC /
        nominalDifference,

      0,

      ACS_CONSTANTS
        .IMMERSED_EXCHANGER_MAX_CORRECTION_FACTOR
    );
  }

  /**
   * Potencia efectiva disponible en el intercambiador.
   *
   * Es dinámica porque en el serpentín cambia con la carga.
   */
  get effectiveExchangerPowerKW() {
    return (
      this.exchangerPowerKW *
      this.thermalCorrectionFactor
    );
  }

  /**
   * Energía disponible antes de alcanzar el 0 %.
   */
  get availableEnergyKWh() {
    return Math.max(
      0,
      this.energyKWh
    );
  }

  /**
   * Energía que todavía puede absorber.
   */
  get remainingCapacityKWh() {
    return Math.max(
      0,
      this.maximumUsefulEnergyKWh -
        this.energyKWh
    );
  }

  get isFull() {
    return (
      this.remainingCapacityKWh <=
      ACS_CONSTANTS
        .DEFAULT_CONVERGENCE_TOLERANCE
    );
  }

  get isEmpty() {
    return (
      this.availableEnergyKWh <=
      ACS_CONSTANTS
        .DEFAULT_CONVERGENCE_TOLERANCE
    );
  }

  /**
   * Fija directamente el porcentaje de carga.
   */
  setLoadPercent(loadPercent) {
    requireNumberInRange(
      loadPercent,
      ACS_CONSTANTS.MIN_LOAD_PERCENT,
      ACS_CONSTANTS.MAX_LOAD_PERCENT,
      `${this.id}.loadPercent`
    );

    this.energyKWh =
      this.maximumUsefulEnergyKWh *
      loadPercent /
      100;

    this.normalizeState();
  }

  /**
   * Permite actualizar las condiciones reales del primario
   * sin reconstruir el depósito.
   */
  setActualPrimaryTemperatures(
    inletTemperatureC,
    outletTemperatureC
  ) {
    if (
      this.exchangerType !==
      ACS_EXCHANGER_TYPES.IMMERSED
    ) {
      throw new ACSSimulationError(
        `${this.id}: las temperaturas reales del primario solo se aplican a un serpentín sumergido.`
      );
    }

    requireFiniteNumber(
      inletTemperatureC,
      `${this.id}.actualPrimaryInletTemperatureC`
    );

    requireFiniteNumber(
      outletTemperatureC,
      `${this.id}.actualPrimaryOutletTemperatureC`
    );

    if (
      inletTemperatureC <=
      outletTemperatureC
    ) {
      throw new ACSSimulationError(
        `${this.id}: la ida real del primario debe ser mayor que el retorno real.`,
        {
          inletTemperatureC,
          outletTemperatureC
        }
      );
    }

    this.actualPrimaryInletTemperatureC =
      inletTemperatureC;

    this.actualPrimaryOutletTemperatureC =
      outletTemperatureC;
  }

  /**
   * Extrae energía del depósito.
   */
  extractEnergy(requestedEnergyKWh) {
    requireNonNegativeNumber(
      requestedEnergyKWh,
      "requestedEnergyKWh"
    );

    const extractedEnergyKWh =
      Math.min(
        requestedEnergyKWh,
        this.availableEnergyKWh
      );

    this.energyKWh -=
      extractedEnergyKWh;

    this.normalizeState();

    return extractedEnergyKWh;
  }

  /**
   * Añade energía al depósito.
   */
  addEnergy(offeredEnergyKWh) {
    requireNonNegativeNumber(
      offeredEnergyKWh,
      "offeredEnergyKWh"
    );

    const absorbedEnergyKWh =
      Math.min(
        offeredEnergyKWh,
        this.remainingCapacityKWh
      );

    this.energyKWh +=
      absorbedEnergyKWh;

    this.normalizeState();

    return absorbedEnergyKWh;
  }

  /**
   * Potencia máxima absorbible durante una duración.
   *
   * Límites:
   * - potencia efectiva del intercambiador;
   * - capacidad energética restante.
   */
  getMaximumAbsorbablePowerKW(
    minutes = 1
  ) {
    requirePositiveNumber(
      minutes,
      "minutes"
    );

    const capacityLimitedPowerKW =
      this.remainingCapacityKWh *
      ACS_CONSTANTS.MINUTES_PER_HOUR /
      minutes;

    return Math.min(
      this.effectiveExchangerPowerKW,
      capacityLimitedPowerKW
    );
  }

  /**
   * Aplica potencia al depósito durante un tiempo.
   */
  applyPower(
    requestedPowerKW,
    minutes = 1
  ) {
    requireNonNegativeNumber(
      requestedPowerKW,
      "requestedPowerKW"
    );

    requirePositiveNumber(
      minutes,
      "minutes"
    );

    /**
     * La potencia efectiva del intercambiador se evalúa antes de
     * añadir energía. En el paso siguiente se recalculará con el
     * nuevo estado de carga.
     */
    const availableExchangerPowerKW =
      this.effectiveExchangerPowerKW;

    const allowedPowerKW =
      Math.min(
        requestedPowerKW,
        availableExchangerPowerKW
      );

    const offeredEnergyKWh =
      powerToEnergy(
        allowedPowerKW,
        minutes
      );

    const absorbedEnergyKWh =
      this.addEnergy(
        offeredEnergyKWh
      );

    const effectiveMinutes =
      allowedPowerKW > 0
        ? (
            absorbedEnergyKWh /
            allowedPowerKW *
            ACS_CONSTANTS.MINUTES_PER_HOUR
          )
        : 0;

    const effectivePowerKW =
      minutes > 0
        ? (
            absorbedEnergyKWh *
            ACS_CONSTANTS.MINUTES_PER_HOUR /
            minutes
          )
        : 0;

    return {
      requestedPowerKW,

      exchangerType:
        this.exchangerType,

      nominalExchangerPowerKW:
        this.exchangerPowerKW,

      availableExchangerPowerKW,

      thermalCorrectionFactor:
        this.thermalCorrectionFactor,

      effectivePowerKW,
      absorbedEnergyKWh,
      effectiveMinutes
    };
  }

  /**
   * Extrae la energía asociada al paso de un volumen de agua.
   */
  processWaterFlow(
    volumeL,
    inletTemperatureC,
    requestedOutletTemperatureC =
      this.outletTemperatureC
  ) {
    requireNonNegativeNumber(
      volumeL,
      "volumeL"
    );

    requireFiniteNumber(
      inletTemperatureC,
      "inletTemperatureC"
    );

    requireFiniteNumber(
      requestedOutletTemperatureC,
      "requestedOutletTemperatureC"
    );

    if (volumeL === 0) {
      return {
        volumeL: 0,
        inletTemperatureC,
        requestedOutletTemperatureC,

        actualOutletTemperatureC:
          requestedOutletTemperatureC,

        requestedEnergyKWh: 0,
        deliveredEnergyKWh: 0,
        unmetEnergyKWh: 0
      };
    }

    const targetOutletTemperatureC =
      clamp(
        requestedOutletTemperatureC,
        inletTemperatureC,
        this.storageTemperatureC
      );

    const requestedEnergyKWh =
      waterEnergyFromDeltaTemperature(
        volumeL,
        Math.max(
          0,
          targetOutletTemperatureC -
            inletTemperatureC
        )
      );

    const deliveredEnergyKWh =
      this.extractEnergy(
        requestedEnergyKWh
      );

    const actualTemperatureIncreaseC =
      deliveredEnergyKWh /
      (
        volumeL *
        ACS_CONSTANTS
          .WATER_KWH_PER_LITRE_K
      );

    const actualOutletTemperatureC =
      clamp(
        inletTemperatureC +
          actualTemperatureIncreaseC,

        inletTemperatureC,
        targetOutletTemperatureC
      );

    return {
      volumeL,
      inletTemperatureC,

      requestedOutletTemperatureC:
        targetOutletTemperatureC,

      actualOutletTemperatureC,
      requestedEnergyKWh,
      deliveredEnergyKWh,

      unmetEnergyKWh:
        Math.max(
          0,
          requestedEnergyKWh -
            deliveredEnergyKWh
        )
    };
  }

  /**
   * Corrige errores numéricos.
   */
  normalizeState() {
    this.energyKWh =
      clamp(
        this.energyKWh,
        0,
        this.maximumUsefulEnergyKWh
      );

    if (
      Math.abs(this.energyKWh) <
      ACS_CONSTANTS
        .DEFAULT_CONVERGENCE_TOLERANCE
    ) {
      this.energyKWh = 0;
    }

    if (
      Math.abs(
        this.energyKWh -
        this.maximumUsefulEnergyKWh
      ) <
      ACS_CONSTANTS
        .DEFAULT_CONVERGENCE_TOLERANCE
    ) {
      this.energyKWh =
        this.maximumUsefulEnergyKWh;
    }
  }

  /**
   * Instantánea serializable del depósito.
   */
  getState() {
    return {
      id: this.id,
      volumeL: this.volumeL,

      exchangerType:
        this.exchangerType,

      exchangerPowerKW:
        this.exchangerPowerKW,

      effectiveExchangerPowerKW:
        this.effectiveExchangerPowerKW,

      thermalCorrectionFactor:
        this.thermalCorrectionFactor,

      nominalPrimaryInletTemperatureC:
        this.nominalPrimaryInletTemperatureC,

      nominalPrimaryOutletTemperatureC:
        this.nominalPrimaryOutletTemperatureC,

      nominalPrimaryMeanTemperatureC:
        this.nominalPrimaryMeanTemperatureC,

      nominalSecondaryInletTemperatureC:
        this.nominalSecondaryInletTemperatureC,

      nominalSecondaryOutletTemperatureC:
        this.nominalSecondaryOutletTemperatureC,

      nominalSecondaryMeanTemperatureC:
        this.nominalSecondaryMeanTemperatureC,

      nominalTemperatureDifferenceC:
        this.nominalTemperatureDifferenceC,

      actualPrimaryInletTemperatureC:
        this.actualPrimaryInletTemperatureC,

      actualPrimaryOutletTemperatureC:
        this.actualPrimaryOutletTemperatureC,

      actualPrimaryMeanTemperatureC:
        this.actualPrimaryMeanTemperatureC,

      actualTemperatureDifferenceC:
        this.actualTemperatureDifferenceC,

      lowerZoneLoadPercent:
        this.lowerZoneLoadPercent,

      lowerZoneTemperatureC:
        this.lowerZoneTemperatureC,

      energyKWh:
        this.energyKWh,

      maximumUsefulEnergyKWh:
        this.maximumUsefulEnergyKWh,

      remainingCapacityKWh:
        this.remainingCapacityKWh,

      loadPercent:
        this.loadPercent,

      averageTemperatureC:
        this.averageTemperatureC,

      outletTemperatureC:
        this.outletTemperatureC,

      isFull:
        this.isFull,

      isEmpty:
        this.isEmpty
    };
  }
}

/**
 * Normaliza el identificador del perfil intrahorario.
 */
function normalizeIntrahourDemandProfileType(
  value
) {
  const normalized =
    String(
      value === undefined ||
      value === null ||
      value === ""
        ? ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
            .UNIFORM
        : value
    )
      .trim()
      .toLowerCase();

  const allowedValues =
    Object.values(
      ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
    );

  if (
    !allowedValues.includes(
      normalized
    )
  ) {
    throw new ACSSimulationError(
      "Tipo de perfil intrahorario no válido.",
      {
        value,
        allowedValues
      }
    );
  }

  return normalized;
}


/**
 * Crea un perfil uniforme dentro de un intervalo.
 */
function createActiveWindowWeights(
  startMinute,
  durationMinutes
) {
  requireNumberInRange(
    startMinute,
    0,
    59,
    "startMinute"
  );

  requireNumberInRange(
    durationMinutes,
    1,
    60,
    "durationMinutes"
  );

  if (
    startMinute +
    durationMinutes >
    60
  ) {
    throw new ACSSimulationError(
      "La ventana intrahoraria no puede superar los 60 minutos.",
      {
        startMinute,
        durationMinutes
      }
    );
  }

  const weights =
    new Array(60).fill(0);

  const activeWeight =
    1 / durationMinutes;

  for (
    let minute =
      startMinute;
    minute <
      startMinute +
      durationMinutes;
    minute += 1
  ) {
    weights[minute] =
      activeWeight;
  }

  return weights;
}


/**
 * Crea los 60 pesos de un perfil intrahorario.
 */
function createIntrahourDemandWeights(
  profileType
) {
  const normalizedType =
    normalizeIntrahourDemandProfileType(
      profileType
    );

  switch (normalizedType) {
    case ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
      .UNIFORM:
      return createActiveWindowWeights(
        0,
        60
      );

    case ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
      .FRONT_LOADED_30:
      return createActiveWindowWeights(
        0,
        30
      );

    case ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
      .CENTERED_30:
      return createActiveWindowWeights(
        15,
        30
      );

    case ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
      .BACK_LOADED_30:
      return createActiveWindowWeights(
        30,
        30
      );

    case ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
      .FRONT_LOADED_15:
      return createActiveWindowWeights(
        0,
        15
      );

    case ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
      .CENTERED_15:
      return createActiveWindowWeights(
        22,
        15
      );

    case ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
      .DOUBLE_PEAK: {
      const weights =
        new Array(60).fill(0);

      /*
       * Dos bloques de 15 minutos:
       * - minutos 0 a 14;
       * - minutos 45 a 59.
       *
       * Cada bloque concentra el 50 % del volumen horario.
       */
      const activeWeight =
        1 / 30;

      for (
        let minute = 0;
        minute < 15;
        minute += 1
      ) {
        weights[minute] =
          activeWeight;
      }

      for (
        let minute = 45;
        minute < 60;
        minute += 1
      ) {
        weights[minute] =
          activeWeight;
      }

      return weights;
    }

    default:
      throw new ACSSimulationError(
        "No se ha podido construir el perfil intrahorario.",
        {
          profileType:
            normalizedType
        }
      );
  }
}


/**
 * Comprueba que los pesos intrahorarios sean válidos.
 */
function validateIntrahourDemandWeights(
  weights,
  tolerance = 1e-9
) {
  if (
    !Array.isArray(weights) ||
    weights.length !== 60
  ) {
    throw new ACSSimulationError(
      "El perfil intrahorario debe contener exactamente 60 pesos."
    );
  }

  requireNonNegativeNumber(
    tolerance,
    "tolerance"
  );

  weights.forEach(
    (
      weight,
      minuteIndex
    ) => {
      requireNonNegativeNumber(
        weight,
        `weights[${minuteIndex}]`
      );
    }
  );

  const totalWeight =
    weights.reduce(
      (
        total,
        weight
      ) =>
        total + weight,
      0
    );

  if (
    Math.abs(
      totalWeight - 1
    ) >
    tolerance
  ) {
    throw new ACSSimulationError(
      "Los pesos intrahorarios deben sumar 1.",
      {
        totalWeight,
        tolerance
      }
    );
  }

  return [...weights];
}


/**
 * Normaliza un perfil horario.
 *
 * Se admiten 24 o 48 valores.
 */
function normalizeHourlyDemandProfile(
  hourlyDemandL
) {
  if (
    !Array.isArray(hourlyDemandL)
  ) {
    throw new ACSSimulationError(
      "hourlyDemandL debe ser un array."
    );
  }

  if (
    hourlyDemandL.length !== 24 &&
    hourlyDemandL.length !== 48
  ) {
    throw new ACSSimulationError(
      "hourlyDemandL debe contener 24 o 48 valores.",
      {
        receivedLength:
          hourlyDemandL.length
      }
    );
  }

  hourlyDemandL.forEach(
    (value, index) => {
      requireNonNegativeNumber(
        value,
        `hourlyDemandL[${index}]`
      );
    }
  );

  if (
    hourlyDemandL.length === 48
  ) {
    return [...hourlyDemandL];
  }

  return [
    ...hourlyDemandL,
    ...hourlyDemandL
  ];
}

/**
 * ============================================================
 * PERFILES DE DEMANDA DIARIA DE ACS
 * ============================================================
 */

const ACS_DEMAND_PROFILES =
  Object.freeze({
    residential:
      Object.freeze([
        1, 1, 1, 1, 1, 2,
        5, 8, 8, 5, 4, 4,
        4, 4, 4, 5, 6, 7,
        8, 7, 6, 4, 2, 2
      ]),

    hotel:
      Object.freeze([
        1, 1, 1, 1, 1, 2,
        6, 14, 16, 9, 4, 3,
        3, 3, 3, 4, 5, 7,
        7, 5, 2, 1, 1, 0
      ]),

    gym:
      Object.freeze([
        0, 0, 0, 0, 0, 1,
        3, 8, 15, 12, 4, 2,
        2, 2, 3, 5, 10, 16,
        10, 4, 2, 1, 0, 0
      ])
  });

/**
 * Normaliza un reparto porcentual de 24 horas.
 */
function normalizeDemandDistributionPercent(
  hourlyPercentages,
  tolerancePercent = 0.01
) {
  if (
    !Array.isArray(hourlyPercentages)
  ) {
    throw new ACSSimulationError(
      "hourlyPercentages debe ser un array."
    );
  }

  if (
    hourlyPercentages.length !== 24
  ) {
    throw new ACSSimulationError(
      "El reparto horario debe contener exactamente 24 porcentajes.",
      {
        receivedLength:
          hourlyPercentages.length
      }
    );
  }

  requireNonNegativeNumber(
    tolerancePercent,
    "tolerancePercent"
  );

  const normalized =
    hourlyPercentages.map(
      (value, hourIndex) => {
        requireNonNegativeNumber(
          value,
          `hourlyPercentages[${hourIndex}]`
        );

        return value;
      }
    );

  const totalPercent =
    normalized.reduce(
      (total, value) =>
        total + value,
      0
    );

  if (
    Math.abs(
      totalPercent - 100
    ) > tolerancePercent
  ) {
    throw new ACSSimulationError(
      "El reparto horario debe sumar 100 %.",
      {
        totalPercent,
        tolerancePercent
      }
    );
  }

  return normalized.map(
    value =>
      value / totalPercent
  );
}

/**
 * Obtiene los pesos horarios de un perfil.
 */
function getDemandProfileWeights(
  profileType,
  customHourlyPercentages = null
) {
  const normalizedProfileType =
    String(
      profileType || ""
    ).toLowerCase();

  if (
    normalizedProfileType === "custom"
  ) {
    return normalizeDemandDistributionPercent(
      customHourlyPercentages
    );
  }

  const profile =
    ACS_DEMAND_PROFILES[
      normalizedProfileType
    ];

  if (!profile) {
    throw new ACSSimulationError(
      "Tipo de perfil de demanda no válido.",
      {
        profileType,

        allowedProfiles: [
          "residential",
          "hotel",
          "gym",
          "custom"
        ]
      }
    );
  }

  return normalizeDemandDistributionPercent(
    [...profile]
  );
}

/**
 * Demanda diaria total a 60 °C.
 */
function calculateDailyDemandAt60CL(
  numberOfPeople,
  unitVolumeAt60CPerPersonDayL
) {
  requirePositiveNumber(
    numberOfPeople,
    "numberOfPeople"
  );

  requirePositiveNumber(
    unitVolumeAt60CPerPersonDayL,
    "unitVolumeAt60CPerPersonDayL"
  );

  return (
    numberOfPeople *
    unitVolumeAt60CPerPersonDayL
  );
}

/**
 * Genera el perfil horario de demanda a 60 °C.
 */
function createDailyDemandProfileAt60C(
  params
) {
  if (
    !params ||
    typeof params !== "object"
  ) {
    throw new ACSSimulationError(
      "La configuración del perfil de demanda es obligatoria."
    );
  }

  const numberOfPeople =
    requirePositiveNumber(
      params.numberOfPeople,
      "numberOfPeople"
    );

  const unitVolumeAt60CPerPersonDayL =
    requirePositiveNumber(
      params
        .unitVolumeAt60CPerPersonDayL,
      "unitVolumeAt60CPerPersonDayL"
    );

  const profileType =
    String(
      params.profileType ||
      "residential"
    ).toLowerCase();

  const profileWeights =
    getDemandProfileWeights(
      profileType,
      params.customHourlyPercentages
    );

  const totalDailyDemandAt60CL =
    calculateDailyDemandAt60CL(
      numberOfPeople,
      unitVolumeAt60CPerPersonDayL
    );

  const hourlyDemandAt60CL =
    profileWeights.map(
      weight =>
        totalDailyDemandAt60CL *
        weight
    );

  return {
    profileType,
    numberOfPeople,
    unitVolumeAt60CPerPersonDayL,
    totalDailyDemandAt60CL,

    hourlyDistributionPercent:
      profileWeights.map(
        weight =>
          weight * 100
      ),

    hourlyDemandAt60CL
  };
}

/**
 * Convierte un volumen referido a 60 °C al volumen equivalente
 * a la temperatura de uso.
 */
function convertDemandVolumeAt60ToUseTemperature(
  volumeAt60CL,
  networkTemperatureC,
  useTemperatureC
) {
  requireNonNegativeNumber(
    volumeAt60CL,
    "volumeAt60CL"
  );

  requireFiniteNumber(
    networkTemperatureC,
    "networkTemperatureC"
  );

  requireFiniteNumber(
    useTemperatureC,
    "useTemperatureC"
  );

  const referenceTemperatureC = 60;

  if (
    networkTemperatureC >=
    referenceTemperatureC
  ) {
    throw new ACSSimulationError(
      "networkTemperatureC debe ser menor que 60 °C."
    );
  }

  if (
    useTemperatureC <=
    networkTemperatureC
  ) {
    throw new ACSSimulationError(
      "useTemperatureC debe ser mayor que networkTemperatureC."
    );
  }

  return (
    volumeAt60CL *
    (
      referenceTemperatureC -
      networkTemperatureC
    ) /
    (
      useTemperatureC -
      networkTemperatureC
    )
  );
}

/**
 * Convierte el perfil completo de 60 °C a Tuso.
 */
function convertDemandProfileAt60ToUseTemperature(
  hourlyDemandAt60CL,
  networkTemperatureC,
  useTemperatureC
) {
  if (
    !Array.isArray(hourlyDemandAt60CL)
  ) {
    throw new ACSSimulationError(
      "hourlyDemandAt60CL debe ser un array."
    );
  }

  return hourlyDemandAt60CL.map(
    (
      volumeAt60CL,
      hourIndex
    ) => {
      requireNonNegativeNumber(
        volumeAt60CL,
        `hourlyDemandAt60CL[${hourIndex}]`
      );

      return convertDemandVolumeAt60ToUseTemperature(
        volumeAt60CL,
        networkTemperatureC,
        useTemperatureC
      );
    }
  );
}

/**
 * Valida y normaliza la configuración general.
 */
function normalizeSimulationConfig(
  inputConfig
) {
  if (
    !inputConfig ||
    typeof inputConfig !== "object"
  ) {
    throw new ACSSimulationError(
      "La configuración de simulación es obligatoria."
    );
  }

  const tankCount =
    inputConfig.tankCount;

  if (
    tankCount !== 1 &&
    tankCount !== 2
  ) {
    throw new ACSSimulationError(
      "tankCount debe ser 1 o 2.",
      { tankCount }
    );
  }

  if (
    !Array.isArray(
      inputConfig.tanks
    )
  ) {
    throw new ACSSimulationError(
      "tanks debe ser un array."
    );
  }

  if (
    inputConfig.tanks.length !==
    tankCount
  ) {
    throw new ACSSimulationError(
      "El número de depósitos no coincide con tankCount.",
      {
        tankCount,

        tanksLength:
          inputConfig.tanks.length
      }
    );
  }

  const storageTemperatureC =
    requireFiniteNumber(
      inputConfig.storageTemperatureC,
      "storageTemperatureC"
    );

  const useTemperatureC =
    requireFiniteNumber(
      inputConfig.useTemperatureC,
      "useTemperatureC"
    );

  const networkTemperatureC =
    requireFiniteNumber(
      inputConfig.networkTemperatureC,
      "networkTemperatureC"
    );

  if (
    storageTemperatureC <=
    useTemperatureC
  ) {
    throw new ACSSimulationError(
      "Tacum debe ser mayor que Tuso.",
      {
        storageTemperatureC,
        useTemperatureC
      }
    );
  }

  if (
    useTemperatureC <=
    networkTemperatureC
  ) {
    throw new ACSSimulationError(
      "Tuso debe ser mayor que Tred.",
      {
        useTemperatureC,
        networkTemperatureC
      }
    );
  }

  const generatorPowerKW =
    requireNonNegativeNumber(
      inputConfig.generatorPowerKW,
      "generatorPowerKW"
    );

  const generatorRampMinutes =
    inputConfig.generatorRampMinutes === undefined
      ? 0
      : requireNonNegativeNumber(
          inputConfig.generatorRampMinutes,
          "generatorRampMinutes"
        );

  const minimumGeneratorStartIntervalMinutes =
    inputConfig.minimumGeneratorStartIntervalMinutes === undefined
      ? 0
      : requireNonNegativeNumber(
          inputConfig.minimumGeneratorStartIntervalMinutes,
          "minimumGeneratorStartIntervalMinutes"
        );

  const hasSufficientGeneratorInertia =
    inputConfig.hasSufficientGeneratorInertia === undefined
      ? true
      : Boolean(
          inputConfig.hasSufficientGeneratorInertia
        );

  const generatorMinimumPowerKW =
    inputConfig.generatorMinimumPowerKW === undefined
      ? 0
      : requireNonNegativeNumber(
          inputConfig.generatorMinimumPowerKW,
          "generatorMinimumPowerKW"
        );

  const maximumBelowMinimumPowerMinutes =
    inputConfig.maximumBelowMinimumPowerMinutes === undefined
      ? 0
      : requireNonNegativeNumber(
          inputConfig.maximumBelowMinimumPowerMinutes,
          "maximumBelowMinimumPowerMinutes"
        );

  if (
    generatorMinimumPowerKW >
    generatorPowerKW
  ) {
    throw new ACSSimulationError(
      "La potencia mínima del generador no puede superar su potencia nominal.",
      {
        generatorMinimumPowerKW,
        generatorPowerKW
      }
    );
  }

  const startThresholdPercent =
    requireNumberInRange(
      inputConfig.startThresholdPercent,
      0,
      100,
      "startThresholdPercent"
    );

  const lossPercent =
    inputConfig.lossPercent === undefined
      ? 0
      : requireNumberInRange(
          inputConfig.lossPercent,
          0,
          100,
          "lossPercent"
        );

  const sanitaryCheck =
    Boolean(
      inputConfig.sanitaryCheck
    );

  const intrahourDemandProfileType =
    normalizeIntrahourDemandProfileType(
      inputConfig
        .intrahourDemandProfileType ??
      inputConfig
        .demandProfile
        ?.intrahourProfileType
    );

  const intrahourDemandWeights =
    validateIntrahourDemandWeights(
      createIntrahourDemandWeights(
        intrahourDemandProfileType
      )
    );

  let generatedDemandProfile = null;

  if (
    inputConfig.demandProfile &&
    typeof inputConfig.demandProfile ===
      "object"
  ) {
    generatedDemandProfile =
      createDailyDemandProfileAt60C({
        numberOfPeople:
          inputConfig
            .demandProfile
            .numberOfPeople,

        unitVolumeAt60CPerPersonDayL:
          inputConfig
            .demandProfile
            .unitVolumeAt60CPerPersonDayL,

        profileType:
          inputConfig
            .demandProfile
            .profileType,

        customHourlyPercentages:
          inputConfig
            .demandProfile
            .customHourlyPercentages
      });
  }

  const hourlyDemandAt60CInput =
    generatedDemandProfile
      ? generatedDemandProfile
          .hourlyDemandAt60CL
      : (
          inputConfig
            .hourlyDemandAt60CL ??
          inputConfig
            .hourlyDemandL
        );

  const hourlyDemandAt60CL =
    normalizeHourlyDemandProfile(
      hourlyDemandAt60CInput
    );

  const hourlyDemandL =
    convertDemandProfileAt60ToUseTemperature(
      hourlyDemandAt60CL,
      networkTemperatureC,
      useTemperatureC
    );

  /*
   * Las pérdidas se definen como porcentaje de la demanda energética
   * diaria. El perfil de 48 h repite el día, por lo que se toma únicamente
   * el primer periodo de 24 h como referencia.
   */
  const dailyDemandEnergyKWh =
    hourlyDemandL
      .slice(0, ACS_CONSTANTS.HOURS_PER_DAY)
      .reduce(
        (total, volumeL) =>
          total +
          waterEnergyRelativeToNetwork(
            volumeL,
            useTemperatureC,
            networkTemperatureC
          ),
        0
      );

  const dailyRecirculationLossTargetKWh =
    dailyDemandEnergyKWh * lossPercent / 100;

  const recirculationLossTargetKWhPerMinute =
    dailyRecirculationLossTargetKWh /
    (ACS_CONSTANTS.HOURS_PER_DAY * ACS_CONSTANTS.MINUTES_PER_HOUR);

  const recirculationFlowLPerMinute =
    recirculationLossTargetKWhPerMinute > 0
      ? equivalentVolumeFromEnergy(
          recirculationLossTargetKWhPerMinute,
          ACS_CONSTANTS.RECIRCULATION_DESIGN_DELTA_T_C
        )
      : 0;

  const tanks =
    inputConfig.tanks.map(
      (
        tankConfig,
        index
      ) => {
        const id =
          `D${index + 1}`;

        const normalizedExchanger =
          normalizeTankExchangerConfig(
            tankConfig,
            `tanks[${index}]`
          );

        return {
          id,

          volumeL:
            requirePositiveNumber(
              tankConfig.volumeL,
              `tanks[${index}].volumeL`
            ),

          exchangerType:
            normalizedExchanger
              .exchangerType,

          exchangerPowerKW:
            normalizedExchanger
              .exchangerPowerKW,

          nominalPrimaryInletTemperatureC:
            normalizedExchanger
              .nominalPrimaryInletTemperatureC,

          nominalPrimaryOutletTemperatureC:
            normalizedExchanger
              .nominalPrimaryOutletTemperatureC,

          nominalSecondaryInletTemperatureC:
            normalizedExchanger
              .nominalSecondaryInletTemperatureC,

          nominalSecondaryOutletTemperatureC:
            normalizedExchanger
              .nominalSecondaryOutletTemperatureC,

          actualPrimaryInletTemperatureC:
            normalizedExchanger
              .actualPrimaryInletTemperatureC,

          actualPrimaryOutletTemperatureC:
            normalizedExchanger
              .actualPrimaryOutletTemperatureC,

          storageTemperatureC,
          networkTemperatureC,

          /**
           * Se conserva el comportamiento actual del motor:
           * la simulación normalizada comienza al 100 %.
           */
          initialLoadPercent: 100
        };
      }
    );

  return {
    tankCount,
    tanks,

    generatorPowerKW,
    generatorRampMinutes,
    minimumGeneratorStartIntervalMinutes,
    hasSufficientGeneratorInertia,
    generatorMinimumPowerKW,
    maximumBelowMinimumPowerMinutes,
    startThresholdPercent,

    storageTemperatureC,
    useTemperatureC,
    networkTemperatureC,

    demandReferenceTemperatureC: 60,

    intrahourDemandProfileType,

    intrahourDemandProfileLabel:
      ACS_INTRAHOUR_DEMAND_PROFILE_LABELS[
        intrahourDemandProfileType
      ],

    intrahourDemandWeights,

    demandProfile:
      generatedDemandProfile
        ? {
            profileType:
              generatedDemandProfile
                .profileType,

            numberOfPeople:
              generatedDemandProfile
                .numberOfPeople,

            unitVolumeAt60CPerPersonDayL:
              generatedDemandProfile
                .unitVolumeAt60CPerPersonDayL,

            totalDailyDemandAt60CL:
              generatedDemandProfile
                .totalDailyDemandAt60CL,

            hourlyDistributionPercent:
              [
                ...generatedDemandProfile
                  .hourlyDistributionPercent
              ],

            intrahourProfileType:
              intrahourDemandProfileType,

            intrahourProfileLabel:
              ACS_INTRAHOUR_DEMAND_PROFILE_LABELS[
                intrahourDemandProfileType
              ]
          }
        : null,

    hourlyDemandAt60CL,
    hourlyDemandL,

    lossPercent,

    dailyDemandEnergyKWh,
    dailyRecirculationLossTargetKWh,
    recirculationLossTargetKWhPerMinute,

    recirculationDesignDeltaTemperatureC:
      ACS_CONSTANTS.RECIRCULATION_DESIGN_DELTA_T_C,

    /* Resultado derivado, no entrada del usuario. */
    recirculationFlowLPerMinute,

    sanitaryCheck,

    simulationHours:
      ACS_CONSTANTS
        .SIMULATION_HOURS,

    stabilizationHours:
      ACS_CONSTANTS
        .STABILIZATION_HOURS,

    simulationMinutes:
      ACS_CONSTANTS
        .SIMULATION_HOURS *
      ACS_CONSTANTS
        .MINUTES_PER_HOUR,

    stabilizationMinutes:
      ACS_CONSTANTS
        .STABILIZATION_HOURS *
      ACS_CONSTANTS
        .MINUTES_PER_HOUR
  };
}

/**
 * Exportaciones del Bloque 1.
 */
const ACSBlock1 = {
  ACS_CONSTANTS,
  ACS_EXCHANGER_TYPES,
  ACS_INTRAHOUR_DEMAND_PROFILE_TYPES,
  ACS_INTRAHOUR_DEMAND_PROFILE_LABELS,
  ACS_DEMAND_PROFILES,

  ACSSimulationError,
  ACSTank,

  clamp,
  isFiniteNumber,

  powerToEnergy,
  waterEnergyFromDeltaTemperature,
  waterEnergyRelativeToNetwork,
  equivalentVolumeFromEnergy,

  normalizeExchangerType,
  normalizeTankExchangerConfig,

  normalizeIntrahourDemandProfileType,
  createActiveWindowWeights,
  createIntrahourDemandWeights,
  validateIntrahourDemandWeights,

  normalizeDemandDistributionPercent,
  getDemandProfileWeights,
  calculateDailyDemandAt60CL,
  createDailyDemandProfileAt60C,

  normalizeHourlyDemandProfile,

  convertDemandVolumeAt60ToUseTemperature,
  convertDemandProfileAt60ToUseTemperature,

  normalizeSimulationConfig,
  cloneObject
};

if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = ACSBlock1;
} else if (
  typeof window !== "undefined"
) {
  window.ACSBlock1 = ACSBlock1;
}

/**
 * ============================================================
 * BLOQUE 2
 * Demanda, válvula mezcladora, caudales y recirculación
 * ============================================================
 */

/**
 * Obtiene la demanda equivalente correspondiente a un minuto.
 *
 * La memoria establece que la demanda horaria representa un volumen
 * equivalente a la temperatura de utilización.
 *
 * La demanda se distribuye uniformemente entre los 60 minutos.
 *
 * @param {number[]} hourlyDemandL Perfil de 48 horas.
 * @param {number} minuteIndex Índice absoluto del minuto.
 * @returns {{
 *   hourIndex: number,
 *   minuteWithinHour: number,
 *   equivalentDemandVolumeL: number
 * }}
 */
function getMinuteDemand(
  hourlyDemandL,
  minuteIndex,
  intrahourDemandWeights = null
) {
  if (!Array.isArray(hourlyDemandL)) {
    throw new ACSSimulationError(
      "hourlyDemandL debe ser un array."
    );
  }

  requireNonNegativeNumber(
    minuteIndex,
    "minuteIndex"
  );

  const hourIndex =
    Math.floor(
      minuteIndex /
      ACS_CONSTANTS.MINUTES_PER_HOUR
    );

  if (
    hourIndex >=
    hourlyDemandL.length
  ) {
    throw new ACSSimulationError(
      "El minuto solicitado queda fuera del perfil de demanda.",
      {
        minuteIndex,
        hourIndex,
        profileLength:
          hourlyDemandL.length
      }
    );
  }

  const minuteWithinHour =
    minuteIndex %
    ACS_CONSTANTS.MINUTES_PER_HOUR;

  const hourlyVolumeL =
    requireNonNegativeNumber(
      hourlyDemandL[hourIndex],
      `hourlyDemandL[${hourIndex}]`
    );

  let weights;

  if (
    intrahourDemandWeights === null ||
    intrahourDemandWeights ===
      undefined
  ) {
    weights =
      new Array(
        ACS_CONSTANTS
          .MINUTES_PER_HOUR
      ).fill(
        1 /
        ACS_CONSTANTS
          .MINUTES_PER_HOUR
      );
  } else {
    weights =
      validateIntrahourDemandWeights(
        intrahourDemandWeights
      );
  }

  const intrahourWeight =
    weights[
      minuteWithinHour
    ];

  const equivalentDemandVolumeL =
    hourlyVolumeL *
    intrahourWeight;

  return {
    hourIndex,

    minuteWithinHour,

    hourlyDemandVolumeL:
      hourlyVolumeL,

    intrahourWeight,

    equivalentDemandVolumeL
  };
}

/**
 * Calcula la energía correspondiente a una demanda equivalente.
 *
 * La demanda introducida por el usuario está referida a Tuso.
 *
 * @param {number} equivalentVolumeL
 * @param {number} useTemperatureC
 * @param {number} networkTemperatureC
 * @returns {number}
 */
function calculateDemandEnergyKWh(
  equivalentVolumeL,
  useTemperatureC,
  networkTemperatureC
) {
  requireNonNegativeNumber(
    equivalentVolumeL,
    "equivalentVolumeL"
  );

  requireFiniteNumber(
    useTemperatureC,
    "useTemperatureC"
  );

  requireFiniteNumber(
    networkTemperatureC,
    "networkTemperatureC"
  );

  if (
    useTemperatureC <=
    networkTemperatureC
  ) {
    throw new ACSSimulationError(
      "Tuso debe ser mayor que Tred."
    );
  }

  return waterEnergyRelativeToNetwork(
    equivalentVolumeL,
    useTemperatureC,
    networkTemperatureC
  );
}

/**
 * Calcula el volumen de agua caliente que debe aportar el depósito
 * para obtener un volumen equivalente de utilización mediante mezcla.
 *
 * Ecuación de mezcla:
 *
 * Vcaliente · (Tcaliente - Tred)
 * =
 * Vuso · (Tuso - Tred)
 *
 * Por tanto:
 *
 * Vcaliente =
 * Vuso · (Tuso - Tred) / (Tcaliente - Tred)
 *
 * Cuando Tcaliente es inferior a Tuso, no es posible alcanzar la
 * temperatura objetivo. En ese caso, el agua suministrada por el
 * depósito se utiliza sin añadir agua fría.
 *
 * @param {object} params
 * @param {number} params.equivalentUseVolumeL
 * @param {number} params.hotWaterTemperatureC
 * @param {number} params.useTemperatureC
 * @param {number} params.networkTemperatureC
 *
 * @returns {{
 *   equivalentUseVolumeL: number,
 *   hotWaterVolumeL: number,
 *   coldWaterVolumeL: number,
 *   actualUseVolumeL: number,
 *   actualUseTemperatureC: number,
 *   targetReached: boolean
 * }}
 */
function calculateMixingVolumes(params) {
  const {
    equivalentUseVolumeL,
    hotWaterTemperatureC,
    useTemperatureC,
    networkTemperatureC
  } = params;

  requireNonNegativeNumber(
    equivalentUseVolumeL,
    "equivalentUseVolumeL"
  );

  requireFiniteNumber(
    hotWaterTemperatureC,
    "hotWaterTemperatureC"
  );

  requireFiniteNumber(
    useTemperatureC,
    "useTemperatureC"
  );

  requireFiniteNumber(
    networkTemperatureC,
    "networkTemperatureC"
  );

  if (
    useTemperatureC <=
    networkTemperatureC
  ) {
    throw new ACSSimulationError(
      "Tuso debe ser mayor que Tred."
    );
  }

  if (equivalentUseVolumeL === 0) {
    return {
      equivalentUseVolumeL: 0,
      hotWaterVolumeL: 0,
      coldWaterVolumeL: 0,
      actualUseVolumeL: 0,
      actualUseTemperatureC:
        useTemperatureC,
      targetReached: true
    };
  }

  const effectiveHotTemperatureC =
    Math.max(
      networkTemperatureC,
      hotWaterTemperatureC
    );

  /**
   * El depósito puede mantener Tuso.
   */
  if (
    effectiveHotTemperatureC >=
    useTemperatureC
  ) {
    const hotWaterVolumeL =
      equivalentUseVolumeL *
      (
        useTemperatureC -
        networkTemperatureC
      ) /
      (
        effectiveHotTemperatureC -
        networkTemperatureC
      );

    const coldWaterVolumeL =
      equivalentUseVolumeL -
      hotWaterVolumeL;

    return {
      equivalentUseVolumeL,
      hotWaterVolumeL:
        Math.max(0, hotWaterVolumeL),
      coldWaterVolumeL:
        Math.max(0, coldWaterVolumeL),
      actualUseVolumeL:
        equivalentUseVolumeL,
      actualUseTemperatureC:
        useTemperatureC,
      targetReached: true
    };
  }

  /**
   * El depósito no alcanza Tuso.
   *
   * No se añade agua fría, ya que empeoraría la temperatura.
   *
   * Se mantiene el mismo volumen de utilización solicitado,
   * pero a una temperatura inferior.
   */
  return {
    equivalentUseVolumeL,
    hotWaterVolumeL:
      equivalentUseVolumeL,
    coldWaterVolumeL: 0,
    actualUseVolumeL:
      equivalentUseVolumeL,
    actualUseTemperatureC:
      effectiveHotTemperatureC,
    targetReached: false
  };
}

/**
 * Convierte un caudal de litros por minuto en volumen para un intervalo.
 *
 * @param {number} flowLPerMinute
 * @param {number} intervalMinutes
 * @returns {number}
 */
function flowToVolume(
  flowLPerMinute,
  intervalMinutes = 1
) {
  requireNonNegativeNumber(
    flowLPerMinute,
    "flowLPerMinute"
  );

  requireNonNegativeNumber(
    intervalMinutes,
    "intervalMinutes"
  );

  return (
    flowLPerMinute *
    intervalMinutes
  );
}

/**
 * Calcula la temperatura de retorno de la recirculación.
 *
 * Fórmula de la memoria:
 *
 * Tret =
 * Tuso_real
 * -
 * 1.5 · ((Tuso_real - Tred) / (Tuso - Tred))
 *
 * El salto térmico máximo es de 1.5 °C.
 *
 * @param {object} params
 * @param {number} params.actualUseTemperatureC
 * @param {number} params.useTemperatureC
 * @param {number} params.networkTemperatureC
 * @returns {number}
 */
function calculateReturnTemperatureC(params) {
  const {
    actualUseTemperatureC,
    useTemperatureC,
    networkTemperatureC
  } = params;

  requireFiniteNumber(
    actualUseTemperatureC,
    "actualUseTemperatureC"
  );

  requireFiniteNumber(
    useTemperatureC,
    "useTemperatureC"
  );

  requireFiniteNumber(
    networkTemperatureC,
    "networkTemperatureC"
  );

  if (
    useTemperatureC <=
    networkTemperatureC
  ) {
    throw new ACSSimulationError(
      "Tuso debe ser mayor que Tred."
    );
  }

  const normalizedTemperature =
    (
      actualUseTemperatureC -
      networkTemperatureC
    ) /
    (
      useTemperatureC -
      networkTemperatureC
    );

  const boundedFactor = clamp(
    normalizedTemperature,
    0,
    1
  );

  const returnTemperatureC =
    actualUseTemperatureC -
    1.5 * boundedFactor;

  return Math.max(
    networkTemperatureC,
    Math.min(
      actualUseTemperatureC,
      returnTemperatureC
    )
  );
}

/**
 * Calcula la energía perdida en el circuito de recirculación.
 *
 * @param {object} params
 * @param {number} params.recirculationVolumeL
 * @param {number} params.supplyTemperatureC
 * @param {number} params.returnTemperatureC
 * @returns {number}
 */
function calculateRecirculationLossKWh(
  params
) {
  const {
    recirculationVolumeL,
    supplyTemperatureC,
    returnTemperatureC
  } = params;

  requireNonNegativeNumber(
    recirculationVolumeL,
    "recirculationVolumeL"
  );

  requireFiniteNumber(
    supplyTemperatureC,
    "supplyTemperatureC"
  );

  requireFiniteNumber(
    returnTemperatureC,
    "returnTemperatureC"
  );

  const deltaTemperatureC = Math.max(
    0,
    supplyTemperatureC -
    returnTemperatureC
  );

  return waterEnergyFromDeltaTemperature(
    recirculationVolumeL,
    deltaTemperatureC
  );
}

/**
 * Calcula cómo se reparte el caudal total de recirculación
 * entre:
 *
 * - la parte que atraviesa los depósitos;
 * - la parte que vuelve directamente a la toma fría
 *   de la válvula mezcladora.
 *
 * Balance térmico en la mezcladora:
 *
 * Vdep · Thot
 * +
 * Vbypass · Tret
 * =
 * Vtotal · Tuso_real
 *
 * donde:
 *
 * Vtotal = Vdep + Vbypass
 *
 * Por tanto:
 *
 * Vdep =
 * Vtotal ·
 * (Tuso_real - Tret) /
 * (Thot - Tret)
 *
 * @param {object} params
 * @param {number} params.totalRecirculationVolumeL
 * @param {number} params.hotWaterTemperatureC
 * @param {number} params.supplyTemperatureC
 * @param {number} params.returnTemperatureC
 *
 * @returns {{
 *   totalRecirculationVolumeL: number,
 *   tankRecirculationVolumeL: number,
 *   bypassRecirculationVolumeL: number,
 *   targetReached: boolean
 * }}
 */
function calculateRecirculationSplit(
  params
) {
  const {
    totalRecirculationVolumeL,
    hotWaterTemperatureC,
    supplyTemperatureC,
    returnTemperatureC
  } = params;

  requireNonNegativeNumber(
    totalRecirculationVolumeL,
    "totalRecirculationVolumeL"
  );

  requireFiniteNumber(
    hotWaterTemperatureC,
    "hotWaterTemperatureC"
  );

  requireFiniteNumber(
    supplyTemperatureC,
    "supplyTemperatureC"
  );

  requireFiniteNumber(
    returnTemperatureC,
    "returnTemperatureC"
  );

  if (totalRecirculationVolumeL === 0) {
    return {
      totalRecirculationVolumeL: 0,
      tankRecirculationVolumeL: 0,
      bypassRecirculationVolumeL: 0,
      targetReached: true
    };
  }

  /*
   * Si el agua procedente de los depósitos no supera
   * la temperatura de retorno, no existe capacidad
   * de recalentamiento.
   */
  if (
    hotWaterTemperatureC <=
    returnTemperatureC
  ) {
    return {
      totalRecirculationVolumeL,

      tankRecirculationVolumeL:
        totalRecirculationVolumeL,

      bypassRecirculationVolumeL: 0,

      targetReached: false
    };
  }

  /*
   * Si la temperatura caliente no alcanza la temperatura
   * de impulsión requerida, todo el caudal debe atravesar
   * los depósitos y aun así no se alcanzará el objetivo.
   */
  if (
    hotWaterTemperatureC <
    supplyTemperatureC
  ) {
    return {
      totalRecirculationVolumeL,

      tankRecirculationVolumeL:
        totalRecirculationVolumeL,

      bypassRecirculationVolumeL: 0,

      targetReached: false
    };
  }

  const requiredTankVolumeL =
    totalRecirculationVolumeL *
    (
      supplyTemperatureC -
      returnTemperatureC
    ) /
    (
      hotWaterTemperatureC -
      returnTemperatureC
    );

  const tankRecirculationVolumeL =
    clamp(
      requiredTankVolumeL,
      0,
      totalRecirculationVolumeL
    );

  const bypassRecirculationVolumeL =
    Math.max(
      0,
      totalRecirculationVolumeL -
      tankRecirculationVolumeL
    );

  return {
    totalRecirculationVolumeL,

    tankRecirculationVolumeL,

    bypassRecirculationVolumeL,

    targetReached: true
  };
}

/**
 * Calcula el porcentaje energético cubierto de una demanda.
 *
 * @param {number} requestedEnergyKWh
 * @param {number} suppliedEnergyKWh
 * @returns {number}
 */
function calculateCoveragePercent(
  requestedEnergyKWh,
  suppliedEnergyKWh
) {
  requireNonNegativeNumber(
    requestedEnergyKWh,
    "requestedEnergyKWh"
  );

  requireNonNegativeNumber(
    suppliedEnergyKWh,
    "suppliedEnergyKWh"
  );

  if (requestedEnergyKWh === 0) {
    return 100;
  }

  return clamp(
    100 *
      suppliedEnergyKWh /
      requestedEnergyKWh,
    0,
    100
  );
}



/**
 * Calcula la demanda cubierta y no cubierta.
 *
 * Toda energía entregada por debajo de Tuso constituye
 * demanda no cubierta.
 *
 * Se registra:
 * - Energía cubierta.
 * - Energía no cubierta.
 * - Volumen equivalente cubierto.
 * - Volumen equivalente no cubierto.
 *
 * @param {object} params
 * @param {number} params.equivalentDemandVolumeL
 * @param {number} params.actualUseTemperatureC
 * @param {number} params.useTemperatureC
 * @param {number} params.networkTemperatureC
 *
 * @returns {{
 *   requestedEnergyKWh: number,
 *   coveredEnergyKWh: number,
 *   uncoveredEnergyKWh: number,
 *   coveredEquivalentVolumeL: number,
 *   uncoveredEquivalentVolumeL: number,
 *   coveragePercent: number
 * }}
 */
function calculateDemandCoverage(params) {
  const {
    equivalentDemandVolumeL,
    actualUseTemperatureC,
    useTemperatureC,
    networkTemperatureC
  } = params;

  requireNonNegativeNumber(
    equivalentDemandVolumeL,
    "equivalentDemandVolumeL"
  );

  requireFiniteNumber(
    actualUseTemperatureC,
    "actualUseTemperatureC"
  );

  requireFiniteNumber(
    useTemperatureC,
    "useTemperatureC"
  );

  requireFiniteNumber(
    networkTemperatureC,
    "networkTemperatureC"
  );

  const requestedEnergyKWh =
    calculateDemandEnergyKWh(
      equivalentDemandVolumeL,
      useTemperatureC,
      networkTemperatureC
    );

  const actualUsefulDeltaC = clamp(
    actualUseTemperatureC -
      networkTemperatureC,
    0,
    useTemperatureC -
      networkTemperatureC
  );

  const suppliedEnergyKWh =
    waterEnergyFromDeltaTemperature(
      equivalentDemandVolumeL,
      actualUsefulDeltaC
    );

  const coveredEnergyKWh = Math.min(
    requestedEnergyKWh,
    suppliedEnergyKWh
  );

  const uncoveredEnergyKWh = Math.max(
    0,
    requestedEnergyKWh -
      coveredEnergyKWh
  );

  const usefulDeltaC =
    useTemperatureC -
    networkTemperatureC;

  const coveredEquivalentVolumeL =
    usefulDeltaC > 0
      ? equivalentVolumeFromEnergy(
          coveredEnergyKWh,
          usefulDeltaC
        )
      : 0;

  const uncoveredEquivalentVolumeL =
    usefulDeltaC > 0
      ? equivalentVolumeFromEnergy(
          uncoveredEnergyKWh,
          usefulDeltaC
        )
      : 0;

  return {
    requestedEnergyKWh,
    coveredEnergyKWh,
    uncoveredEnergyKWh,
    coveredEquivalentVolumeL,
    uncoveredEquivalentVolumeL,

    coveragePercent:
      calculateCoveragePercent(
        requestedEnergyKWh,
        coveredEnergyKWh
      )
  };
}

/**
 * Calcula los caudales y volúmenes hidráulicos de un minuto.
 *
 * Según la memoria:
 *
 * Desde la mezcla parten simultáneamente:
 * - Caudal de consumo.
 * - Caudal de recirculación.
 *
 * El caudal que atraviesa los depósitos es:
 *
 * caudal de uso + caudal de recirculación
 *
 * En términos de volumen por intervalo:
 *
 * Vdepósitos =
 * Vcaliente_consumo + Vrecirculación
 *
 * @param {object} params
 * @param {number} params.equivalentDemandVolumeL
 * @param {number} params.hotWaterTemperatureC
 * @param {number} params.storageTemperatureC Temperatura de acumulación usada para dimensionar el retorno por depósitos.
 * @param {number} params.useTemperatureC
 * @param {number} params.networkTemperatureC
 * @param {number} params.recirculationFlowLPerMinute Caudal derivado de las pérdidas objetivo.
 * @param {number} [params.intervalMinutes=1]
 *
 * @returns {{
 *   intervalMinutes: number,
 *   mixing: object,
 *   consumptionEquivalentVolumeL: number,
 *   hotConsumptionVolumeL: number,
 *   coldMixingVolumeL: number,
 *   recirculationVolumeL: number,
 *   totalVolumeThroughTanksL: number,
 *   networkReplacementVolumeL: number,
 *   actualUseTemperatureC: number,
 *   returnTemperatureC: number,
 *   recirculationLossKWh: number
 * }}
 */
function calculateMinuteHydraulics(
  params
) {
  const {
    equivalentDemandVolumeL,
    hotWaterTemperatureC,
    storageTemperatureC,
    useTemperatureC,
    networkTemperatureC,
    recirculationFlowLPerMinute,
    intervalMinutes = 1
  } = params;

  requireNonNegativeNumber(
    equivalentDemandVolumeL,
    "equivalentDemandVolumeL"
  );

  requireFiniteNumber(
    hotWaterTemperatureC,
    "hotWaterTemperatureC"
  );

  requireFiniteNumber(
    storageTemperatureC,
    "storageTemperatureC"
  );

  requireFiniteNumber(
    useTemperatureC,
    "useTemperatureC"
  );

  requireFiniteNumber(
    networkTemperatureC,
    "networkTemperatureC"
  );

  requireNonNegativeNumber(
    recirculationFlowLPerMinute,
    "recirculationFlowLPerMinute"
  );

  requirePositiveNumber(
    intervalMinutes,
    "intervalMinutes"
  );

  /*
   * Demanda de consumo.
   *
   * Esta mezcla calcula qué parte procede de los depósitos
   * y qué parte corresponde al agua fría de red.
   */
  const mixing =
    calculateMixingVolumes({
      equivalentUseVolumeL:
        equivalentDemandVolumeL,

      hotWaterTemperatureC,

      useTemperatureC,

      networkTemperatureC
    });

  /*
   * Caudal total que circula por el anillo de recirculación.
   */
  const recirculationVolumeL =
    flowToVolume(
      recirculationFlowLPerMinute,
      intervalMinutes
    );

  /*
   * Temperatura del retorno después de las pérdidas
   * del circuito.
   */
  const returnTemperatureC =
    calculateReturnTemperatureC({
      actualUseTemperatureC:
        mixing.actualUseTemperatureC,

      useTemperatureC,

      networkTemperatureC
    });

  /*
   * Pérdida energética total del anillo.
   *
   * Se calcula sobre todo el caudal recirculado y sobre
   * el salto entre impulsión y retorno.
   */
  const recirculationLossKWh =
    calculateRecirculationLossKWh({
      recirculationVolumeL,

      supplyTemperatureC:
        mixing.actualUseTemperatureC,

      returnTemperatureC
    });

  /*
   * Reparto del retorno en la válvula mezcladora.
   *
   * Solo una fracción del caudal atraviesa los depósitos.
   * El resto vuelve directamente por la toma fría
   * de la mezcladora.
   */
  const recirculationSplit =
    calculateRecirculationSplit({
      totalRecirculationVolumeL:
        recirculationVolumeL,

      /*
       * El retorno que atraviesa los depósitos se calcula con Tacum.
       * No depende de la temperatura instantánea de salida, que sólo
       * afecta después a la entrega real y al balance energético.
       */
      hotWaterTemperatureC:
        storageTemperatureC,

      supplyTemperatureC:
        mixing.actualUseTemperatureC,

      returnTemperatureC
    });

  const tankRecirculationVolumeL =
    recirculationSplit
      .tankRecirculationVolumeL;

  const bypassRecirculationVolumeL =
    recirculationSplit
      .bypassRecirculationVolumeL;

  /*
   * El agua de red que repone el consumo es únicamente
   * el volumen caliente extraído para cubrir la demanda.
   *
   * La recirculación no genera consumo neto de agua.
   */
  const networkReplacementVolumeL =
    mixing.hotWaterVolumeL;

  /*
   * Solo atraviesan los depósitos:
   *
   * - el agua caliente requerida por el consumo;
   * - la fracción del retorno que necesita recalentamiento.
   */
  const totalVolumeThroughTanksL =
    mixing.hotWaterVolumeL +
    tankRecirculationVolumeL;

  return {
    intervalMinutes,

    mixing,

    consumptionEquivalentVolumeL:
      equivalentDemandVolumeL,

    hotConsumptionVolumeL:
      mixing.hotWaterVolumeL,

    coldMixingVolumeL:
      mixing.coldWaterVolumeL,

    /*
     * Caudal total del anillo.
     */
    recirculationVolumeL,

    /*
     * Parte que atraviesa los depósitos.
     */
    tankRecirculationVolumeL,

    /*
     * Parte que vuelve por la toma fría
     * de la mezcladora.
     */
    bypassRecirculationVolumeL,

    recirculationSplitTargetReached:
      recirculationSplit.targetReached,

    totalVolumeThroughTanksL,

    networkReplacementVolumeL,

    actualUseTemperatureC:
      mixing.actualUseTemperatureC,

    returnTemperatureC,

    recirculationLossKWh
  };
}

/**
 * Representa el estado hidráulico de un minuto.
 *
 * Esta clase no modifica todavía los depósitos.
 * Su función es encapsular los cálculos previos a la resolución
 * iterativa del estado energético.
 */
class ACSMinuteHydraulicState {
  /**
   * @param {object} config
   */
  constructor(config) {
    if (
      !config ||
      typeof config !== "object"
    ) {
      throw new ACSSimulationError(
        "La configuración hidráulica es obligatoria."
      );
    }

    this.minuteIndex =
      requireNonNegativeNumber(
        config.minuteIndex,
        "minuteIndex"
      );

    this.hourlyDemandVolumeL =
      config.hourlyDemandVolumeL ===
        undefined
        ? null
        : requireNonNegativeNumber(
            config.hourlyDemandVolumeL,
            "hourlyDemandVolumeL"
          );

    this.intrahourWeight =
      config.intrahourWeight ===
        undefined
        ? null
        : requireNonNegativeNumber(
            config.intrahourWeight,
            "intrahourWeight"
          );

    this.intrahourDemandProfileType =
      config
        .intrahourDemandProfileType ===
        undefined
        ? ACS_INTRAHOUR_DEMAND_PROFILE_TYPES
            .UNIFORM
        : normalizeIntrahourDemandProfileType(
            config
              .intrahourDemandProfileType
          );

    this.equivalentDemandVolumeL =
      requireNonNegativeNumber(
        config.equivalentDemandVolumeL,
        "equivalentDemandVolumeL"
      );

    this.hotWaterTemperatureC =
      requireFiniteNumber(
        config.hotWaterTemperatureC,
        "hotWaterTemperatureC"
      );

    this.storageTemperatureC =
      requireFiniteNumber(
        config.storageTemperatureC,
        "storageTemperatureC"
      );

    this.useTemperatureC =
      requireFiniteNumber(
        config.useTemperatureC,
        "useTemperatureC"
      );

    this.networkTemperatureC =
      requireFiniteNumber(
        config.networkTemperatureC,
        "networkTemperatureC"
      );

    this.recirculationFlowLPerMinute =
      requireNonNegativeNumber(
        config.recirculationFlowLPerMinute,
        "recirculationFlowLPerMinute"
      );

    this.intervalMinutes =
      config.intervalMinutes === undefined
        ? 1
        : requirePositiveNumber(
            config.intervalMinutes,
            "intervalMinutes"
          );

    this.calculate();
  }

  /**
   * Recalcula el estado hidráulico.
   *
   * Será utilizado por el proceso iterativo del Bloque 4,
   * ya que la temperatura de salida puede variar durante la
   * resolución del minuto.
   */
  calculate() {
    const result =
      calculateMinuteHydraulics({
        equivalentDemandVolumeL:
          this.equivalentDemandVolumeL,

        hotWaterTemperatureC:
          this.hotWaterTemperatureC,

        storageTemperatureC:
          this.storageTemperatureC,

        useTemperatureC:
          this.useTemperatureC,

        networkTemperatureC:
          this.networkTemperatureC,

        recirculationFlowLPerMinute:
          this.recirculationFlowLPerMinute,

        intervalMinutes:
          this.intervalMinutes
      });

    Object.assign(this, result);

    this.demandCoverage =
      calculateDemandCoverage({
        equivalentDemandVolumeL:
          this.equivalentDemandVolumeL,

        actualUseTemperatureC:
          this.actualUseTemperatureC,

        useTemperatureC:
          this.useTemperatureC,

        networkTemperatureC:
          this.networkTemperatureC
      });

    return this;
  }

  /**
   * Cambia la temperatura del agua procedente de los depósitos
   * y vuelve a calcular todo el estado hidráulico.
   */
  updateHotWaterTemperature(
    hotWaterTemperatureC
  ) {
    this.hotWaterTemperatureC =
      requireFiniteNumber(
        hotWaterTemperatureC,
        "hotWaterTemperatureC"
      );

    return this.calculate();
  }

  /**
   * Devuelve una copia serializable del estado.
   */
  getState() {
    return {
      minuteIndex:
        this.minuteIndex,

      intervalMinutes:
        this.intervalMinutes,

      hourlyDemandVolumeL:
        this.hourlyDemandVolumeL,

      intrahourWeight:
        this.intrahourWeight,

      intrahourDemandProfileType:
        this
          .intrahourDemandProfileType,

      equivalentDemandVolumeL:
        this.equivalentDemandVolumeL,

      hotWaterTemperatureC:
        this.hotWaterTemperatureC,

      storageTemperatureC:
        this.storageTemperatureC,

      useTemperatureC:
        this.useTemperatureC,

      networkTemperatureC:
        this.networkTemperatureC,

      hotConsumptionVolumeL:
        this.hotConsumptionVolumeL,

      coldMixingVolumeL:
        this.coldMixingVolumeL,

      recirculationVolumeL:
        this.recirculationVolumeL,
        tankRecirculationVolumeL:
  this.tankRecirculationVolumeL,

bypassRecirculationVolumeL:
  this.bypassRecirculationVolumeL,

recirculationSplitTargetReached:
  this.recirculationSplitTargetReached,

      totalVolumeThroughTanksL:
        this.totalVolumeThroughTanksL,

      networkReplacementVolumeL:
        this.networkReplacementVolumeL,

      actualUseTemperatureC:
        this.actualUseTemperatureC,

      returnTemperatureC:
        this.returnTemperatureC,

      recirculationLossKWh:
        this.recirculationLossKWh,

      demandCoverage:
        cloneObject(
          this.demandCoverage
        ),

      targetTemperatureReached:
        this.mixing.targetReached
    };
  }
}

/**
 * Crea el estado hidráulico inicial de un minuto.
 *
 * @param {object} config Configuración normalizada.
 * @param {number} minuteIndex
 * @param {number} tankOutletTemperatureC
 *
 * @returns {ACSMinuteHydraulicState}
 */
function createMinuteHydraulicState(
  config,
  minuteIndex,
  tankOutletTemperatureC
) {
  if (
    !config ||
    typeof config !== "object"
  ) {
    throw new ACSSimulationError(
      "La configuración normalizada es obligatoria."
    );
  }

  const minuteDemand =
    getMinuteDemand(
      config.hourlyDemandL,
      minuteIndex,
      config.intrahourDemandWeights
    );

  return new ACSMinuteHydraulicState({
    minuteIndex,

    hourlyDemandVolumeL:
      minuteDemand
        .hourlyDemandVolumeL,

    intrahourWeight:
      minuteDemand
        .intrahourWeight,

    intrahourDemandProfileType:
      config
        .intrahourDemandProfileType,

    equivalentDemandVolumeL:
      minuteDemand.equivalentDemandVolumeL,

    hotWaterTemperatureC:
      tankOutletTemperatureC,

    storageTemperatureC:
      config.storageTemperatureC,

    useTemperatureC:
      config.useTemperatureC,

    networkTemperatureC:
      config.networkTemperatureC,

    recirculationFlowLPerMinute:
      config.recirculationFlowLPerMinute,

    intervalMinutes: 1
  });
}

/**
 * ============================================================
 * ACTUALIZACIÓN DE EXPORTACIONES
 * ============================================================
 *
 * Este bloque amplía las exportaciones creadas en el Bloque 1.
 */

const ACSBlock2 = {
  getMinuteDemand,

  calculateDemandEnergyKWh,
  calculateMixingVolumes,

  flowToVolume,

  calculateReturnTemperatureC,
  calculateRecirculationLossKWh,
  calculateRecirculationSplit,

  calculateCoveragePercent,
  calculateDemandCoverage,

  calculateMinuteHydraulics,

  ACSMinuteHydraulicState,
  createMinuteHydraulicState
};

/**
 * Node.js
 */
if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = {
    ...module.exports,
    ...ACSBlock2
  };
}

/**
 * Navegador
 */
if (typeof window !== "undefined") {
  window.ACSBlock2 = ACSBlock2;

  window.ACS = {
    ...(window.ACS || {}),
    ...(window.ACSBlock1 || {}),
    ...ACSBlock2
  };
}

/**
 * ============================================================
 * BLOQUE 3
 * Circuito hidráulico de uno y dos depósitos
 * ============================================================
 */

/**
 * Calcula la temperatura resultante de mezclar varios volúmenes
 * de agua.
 *
 * Tmezcla =
 * suma(Vi · Ti) / suma(Vi)
 *
 * @param {Array<{
 *   volumeL: number,
 *   temperatureC: number
 * }>} streams Corrientes de agua.
 *
 * @param {number} fallbackTemperatureC
 *
 * @returns {{
 *   totalVolumeL: number,
 *   mixedTemperatureC: number
 * }}
 */
function mixWaterStreams(
  streams,
  fallbackTemperatureC
) {
  if (!Array.isArray(streams)) {
    throw new ACSSimulationError(
      "streams debe ser un array."
    );
  }

  requireFiniteNumber(
    fallbackTemperatureC,
    "fallbackTemperatureC"
  );

  let totalVolumeL = 0;
  let weightedTemperature = 0;

  streams.forEach((stream, index) => {
    if (
      !stream ||
      typeof stream !== "object"
    ) {
      throw new ACSSimulationError(
        `streams[${index}] no es válido.`
      );
    }

    const volumeL =
      requireNonNegativeNumber(
        stream.volumeL,
        `streams[${index}].volumeL`
      );

    const temperatureC =
      requireFiniteNumber(
        stream.temperatureC,
        `streams[${index}].temperatureC`
      );

    totalVolumeL += volumeL;

    weightedTemperature +=
      volumeL * temperatureC;
  });

  if (totalVolumeL === 0) {
    return {
      totalVolumeL: 0,
      mixedTemperatureC:
        fallbackTemperatureC
    };
  }

  return {
    totalVolumeL,

    mixedTemperatureC:
      weightedTemperature /
      totalVolumeL
  };
}

/**
 * Calcula la energía necesaria para elevar una corriente de agua
 * desde una temperatura de entrada hasta una temperatura de salida.
 *
 * Si la salida solicitada es inferior a la entrada, el valor se limita
 * a cero porque este modelo no contempla que el depósito refrigere
 * activamente el agua.
 *
 * @param {number} volumeL
 * @param {number} inletTemperatureC
 * @param {number} outletTemperatureC
 *
 * @returns {number}
 */
function calculateTankFlowEnergyKWh(
  volumeL,
  inletTemperatureC,
  outletTemperatureC
) {
  requireNonNegativeNumber(
    volumeL,
    "volumeL"
  );

  requireFiniteNumber(
    inletTemperatureC,
    "inletTemperatureC"
  );

  requireFiniteNumber(
    outletTemperatureC,
    "outletTemperatureC"
  );

  const deltaTemperatureC = Math.max(
    0,
    outletTemperatureC -
      inletTemperatureC
  );

  return waterEnergyFromDeltaTemperature(
    volumeL,
    deltaTemperatureC
  );
}

/**
 * Calcula la temperatura de salida posible para una corriente
 * cuando se conoce la energía realmente entregada.
 *
 * Tout =
 * Tin + E / (V · Cp)
 *
 * @param {object} params
 * @param {number} params.volumeL
 * @param {number} params.inletTemperatureC
 * @param {number} params.deliveredEnergyKWh
 * @param {number} params.maximumOutletTemperatureC
 *
 * @returns {number}
 */
function calculateOutletTemperatureFromEnergy(
  params
) {
  const {
    volumeL,
    inletTemperatureC,
    deliveredEnergyKWh,
    maximumOutletTemperatureC
  } = params;

  requireNonNegativeNumber(
    volumeL,
    "volumeL"
  );

  requireFiniteNumber(
    inletTemperatureC,
    "inletTemperatureC"
  );

  requireNonNegativeNumber(
    deliveredEnergyKWh,
    "deliveredEnergyKWh"
  );

  requireFiniteNumber(
    maximumOutletTemperatureC,
    "maximumOutletTemperatureC"
  );

  if (volumeL === 0) {
    return maximumOutletTemperatureC;
  }

  const temperatureIncreaseC =
    deliveredEnergyKWh /
    (
      volumeL *
      ACS_CONSTANTS.WATER_KWH_PER_LITRE_K
    );

  return clamp(
    inletTemperatureC +
      temperatureIncreaseC,

    inletTemperatureC,

    maximumOutletTemperatureC
  );
}

/**
 * Procesa el paso de una corriente de agua a través de un depósito.
 *
 * El depósito intenta entregar agua a su temperatura de salida teórica,
 * definida por su porcentaje de carga.
 *
 * La energía extraída se limita a la energía realmente disponible.
 *
 * @param {ACSTank} tank
 * @param {object} params
 * @param {number} params.volumeL
 * @param {number} params.inletTemperatureC
 * @param {number} [params.requestedOutletTemperatureC]
 *
 * @returns {{
 *   tankId: string,
 *   volumeL: number,
 *   inletTemperatureC: number,
 *   theoreticalOutletTemperatureC: number,
 *   actualOutletTemperatureC: number,
 *   requestedEnergyKWh: number,
 *   deliveredEnergyKWh: number,
 *   unavailableEnergyKWh: number,
 *   initialTankState: object,
 *   finalTankState: object
 * }}
 */
function processFlowThroughTank(
  tank,
  params
) {
  if (!(tank instanceof ACSTank)) {
    throw new ACSSimulationError(
      "tank debe ser una instancia de ACSTank."
    );
  }

  if (
    !params ||
    typeof params !== "object"
  ) {
    throw new ACSSimulationError(
      "Los parámetros del flujo son obligatorios."
    );
  }

  const volumeL =
    requireNonNegativeNumber(
      params.volumeL,
      "volumeL"
    );

  const inletTemperatureC =
    requireFiniteNumber(
      params.inletTemperatureC,
      "inletTemperatureC"
    );

  const theoreticalOutletTemperatureC =
    params.requestedOutletTemperatureC ===
    undefined
      ? tank.outletTemperatureC
      : requireFiniteNumber(
          params.requestedOutletTemperatureC,
          "requestedOutletTemperatureC"
        );

  const boundedOutletTemperatureC = clamp(
    theoreticalOutletTemperatureC,
    inletTemperatureC,
    tank.storageTemperatureC
  );

  const initialTankState =
    tank.getState();

  if (volumeL === 0) {
    return {
      tankId: tank.id,
      volumeL: 0,
      inletTemperatureC,

      theoreticalOutletTemperatureC:
        boundedOutletTemperatureC,

      actualOutletTemperatureC:
        boundedOutletTemperatureC,

      requestedEnergyKWh: 0,
      deliveredEnergyKWh: 0,
      unavailableEnergyKWh: 0,

      initialTankState,
      finalTankState:
        tank.getState()
    };
  }

  const requestedEnergyKWh =
    calculateTankFlowEnergyKWh(
      volumeL,
      inletTemperatureC,
      boundedOutletTemperatureC
    );

  const deliveredEnergyKWh =
    tank.extractEnergy(
      requestedEnergyKWh
    );

  const actualOutletTemperatureC =
    calculateOutletTemperatureFromEnergy({
      volumeL,
      inletTemperatureC,
      deliveredEnergyKWh,

      maximumOutletTemperatureC:
        boundedOutletTemperatureC
    });

  const unavailableEnergyKWh =
    Math.max(
      0,
      requestedEnergyKWh -
        deliveredEnergyKWh
    );

  return {
    tankId: tank.id,
    volumeL,
    inletTemperatureC,

    theoreticalOutletTemperatureC:
      boundedOutletTemperatureC,

    actualOutletTemperatureC,

    requestedEnergyKWh,
    deliveredEnergyKWh,
    unavailableEnergyKWh,

    initialTankState,
    finalTankState:
      tank.getState()
  };
}

/**
 * Calcula la entrada hidráulica de D1.
 *
 * D1 recibe simultáneamente:
 *
 * - Agua fría de red asociada al consumo.
 * - Agua de retorno asociada a la recirculación.
 *
 * @param {object} params
 * @param {number} params.networkReplacementVolumeL
 * @param {number} params.networkTemperatureC
 * @param {number} params.recirculationVolumeL
 * @param {number} params.returnTemperatureC
 *
 * @returns {{
 *   networkReplacementVolumeL: number,
 *   recirculationVolumeL: number,
 *   totalInletVolumeL: number,
 *   inletTemperatureC: number
 * }}
 */
function calculateD1Inlet(params) {
  const {
    networkReplacementVolumeL,
    networkTemperatureC,
    recirculationVolumeL,
    returnTemperatureC
  } = params;

  requireNonNegativeNumber(
    networkReplacementVolumeL,
    "networkReplacementVolumeL"
  );

  requireFiniteNumber(
    networkTemperatureC,
    "networkTemperatureC"
  );

  requireNonNegativeNumber(
    recirculationVolumeL,
    "recirculationVolumeL"
  );

  requireFiniteNumber(
    returnTemperatureC,
    "returnTemperatureC"
  );

  const mixedInlet = mixWaterStreams(
    [
      {
        volumeL:
          networkReplacementVolumeL,

        temperatureC:
          networkTemperatureC
      },
      {
        volumeL:
          recirculationVolumeL,

        temperatureC:
          returnTemperatureC
      }
    ],
    networkTemperatureC
  );

  return {
    networkReplacementVolumeL,
    recirculationVolumeL,

    totalInletVolumeL:
      mixedInlet.totalVolumeL,

    inletTemperatureC:
      mixedInlet.mixedTemperatureC
  };
}

/**
 * Verifica que el volumen de entrada a D1 coincida con el volumen
 * que atraviesa el sistema.
 *
 * Vred + Vretorno =
 * Vconsumo_caliente + Vrecirculación
 *
 * En la formulación adoptada:
 *
 * Vred = Vconsumo_caliente
 *
 * @param {object} hydraulicState
 * @param {number} [tolerance=1e-9]
 *
 * @returns {{
 *   valid: boolean,
 *   inletVolumeL: number,
 *   outletVolumeL: number,
 *   differenceL: number
 * }}
 */
/**
 * Verifica el balance hidráulico de la parte del circuito
 * que realmente atraviesa los depósitos.
 *
 * Vred + Vrec_depósitos
 * =
 * Vtotal_depósitos
 *
 * El caudal de bypass de recirculación no atraviesa
 * los depósitos y, por tanto, no forma parte de este balance.
 *
 * @param {object} hydraulicState
 * @param {number} [tolerance=1e-9]
 *
 * @returns {{
 *   valid: boolean,
 *   networkReplacementVolumeL: number,
 *   tankRecirculationVolumeL: number,
 *   bypassRecirculationVolumeL: number,
 *   totalRecirculationVolumeL: number,
 *   inletVolumeL: number,
 *   outletVolumeL: number,
 *   differenceL: number
 * }}
 */
function validateMinuteHydraulicBalance(
  hydraulicState,
  tolerance =
    ACS_CONSTANTS
      .DEFAULT_CONVERGENCE_TOLERANCE
) {
  if (
    !hydraulicState ||
    typeof hydraulicState !== "object"
  ) {
    throw new ACSSimulationError(
      "hydraulicState es obligatorio."
    );
  }

  requireNonNegativeNumber(
    tolerance,
    "tolerance"
  );

  /*
   * Solo atraviesan los depósitos:
   *
   * - el volumen de reposición de red;
   * - la fracción de recirculación enviada a depósitos.
   */
  const inletVolumeL =
    hydraulicState
      .networkReplacementVolumeL +
    hydraulicState
      .tankRecirculationVolumeL;

  const outletVolumeL =
    hydraulicState
      .totalVolumeThroughTanksL;

  const differenceL =
    inletVolumeL -
    outletVolumeL;

  /*
   * Comprobación del reparto de la recirculación:
   *
   * Vtotal =
   * Vdepósitos + Vbypass
   */
  const recirculationSplitDifferenceL =
    hydraulicState
      .recirculationVolumeL -
    (
      hydraulicState
        .tankRecirculationVolumeL +
      hydraulicState
        .bypassRecirculationVolumeL
    );

  const tankCircuitValid =
    Math.abs(
      differenceL
    ) <= tolerance;

  const recirculationSplitValid =
    Math.abs(
      recirculationSplitDifferenceL
    ) <= tolerance;

  return {
    valid:
      tankCircuitValid &&
      recirculationSplitValid,

    tankCircuitValid,
    recirculationSplitValid,

    inletVolumeL,
    outletVolumeL,
    differenceL,

    recirculationSplitDifferenceL
  };
}

/**
 * Resuelve una pasada hidráulica para una instalación con
 * un único depósito.
 *
 * Recorrido:
 *
 * Agua de red + retorno → D1 → mezcla → consumo y recirculación
 *
 * Esta función modifica energéticamente D1.
 *
 * @param {object} params
 * @param {ACSTank} params.tank
 * @param {ACSMinuteHydraulicState|object} params.hydraulicState
 *
 * @returns {object}
 */
function resolveSingleTankHydraulicPass(
  params
) {
  const {
    tank,
    hydraulicState
  } = params;

  if (!(tank instanceof ACSTank)) {
    throw new ACSSimulationError(
      "tank debe ser una instancia de ACSTank."
    );
  }

  if (
    !hydraulicState ||
    typeof hydraulicState !== "object"
  ) {
    throw new ACSSimulationError(
      "hydraulicState es obligatorio."
    );
  }

  const hydraulicBalance =
    validateMinuteHydraulicBalance(
      hydraulicState
    );

  if (!hydraulicBalance.valid) {
    throw new ACSSimulationError(
      "No se cumple el balance hidráulico del minuto.",
      hydraulicBalance
    );
  }

  const d1Inlet =
    calculateD1Inlet({
      networkReplacementVolumeL:
        hydraulicState
          .networkReplacementVolumeL,

      networkTemperatureC:
        hydraulicState
          .networkTemperatureC,

      recirculationVolumeL:
        hydraulicState
          .tankRecirculationVolumeL,

      returnTemperatureC:
        hydraulicState
          .returnTemperatureC
    });

  const d1Flow =
    processFlowThroughTank(
      tank,
      {
        volumeL:
          hydraulicState
            .totalVolumeThroughTanksL,

        inletTemperatureC:
          d1Inlet.inletTemperatureC,

        requestedOutletTemperatureC:
          tank.outletTemperatureC
      }
    );

  return {
    systemType: "single-tank",

    hydraulicBalance,

    d1Inlet,
    d1Flow,

    finalOutletTemperatureC:
      d1Flow.actualOutletTemperatureC,

    tankDeliveredEnergyKWh:
      d1Flow.deliveredEnergyKWh,

    tankRequestedEnergyKWh:
      d1Flow.requestedEnergyKWh,

    tankUnavailableEnergyKWh:
      d1Flow.unavailableEnergyKWh
  };
}

/**
 * Resuelve una pasada hidráulica para una instalación con
 * dos depósitos en serie.
 *
 * Recorrido:
 *
 * Agua de red + retorno
 * →
 * D1
 * →
 * D2
 * →
 * mezcla
 * →
 * consumo y recirculación
 *
 * La salida real de D1 constituye la entrada de D2.
 *
 * Esta función modifica energéticamente D1 y D2.
 *
 * @param {object} params
 * @param {ACSTank} params.tank1
 * @param {ACSTank} params.tank2
 * @param {ACSMinuteHydraulicState|object} params.hydraulicState
 *
 * @returns {object}
 */
function resolveTwoTankHydraulicPass(
  params
) {
  const {
    tank1,
    tank2,
    hydraulicState
  } = params;

  if (!(tank1 instanceof ACSTank)) {
    throw new ACSSimulationError(
      "tank1 debe ser una instancia de ACSTank."
    );
  }

  if (!(tank2 instanceof ACSTank)) {
    throw new ACSSimulationError(
      "tank2 debe ser una instancia de ACSTank."
    );
  }

  if (
    !hydraulicState ||
    typeof hydraulicState !== "object"
  ) {
    throw new ACSSimulationError(
      "hydraulicState es obligatorio."
    );
  }

  const hydraulicBalance =
    validateMinuteHydraulicBalance(
      hydraulicState
    );

  if (!hydraulicBalance.valid) {
    throw new ACSSimulationError(
      "No se cumple el balance hidráulico del minuto.",
      hydraulicBalance
    );
  }

  /**
   * Entrada simultánea de agua de red y retorno en D1.
   */
  const d1Inlet =
  calculateD1Inlet({
    networkReplacementVolumeL:
      hydraulicState
        .networkReplacementVolumeL,

    networkTemperatureC:
      hydraulicState
        .networkTemperatureC,

    /*
     * El bypass de retorno no pasa por los depósitos.
     */
    recirculationVolumeL:
      hydraulicState
        .tankRecirculationVolumeL,

    returnTemperatureC:
      hydraulicState
        .returnTemperatureC
  });

  /**
   * Paso del volumen total por D1.
   */
  const d1Flow =
    processFlowThroughTank(
      tank1,
      {
        volumeL:
          hydraulicState
            .totalVolumeThroughTanksL,

        inletTemperatureC:
          d1Inlet.inletTemperatureC,

        requestedOutletTemperatureC:
          tank1.outletTemperatureC
      }
    );

  /**
   * La salida de D1 pasa directamente a D2.
   */
  const d2Flow =
    processFlowThroughTank(
      tank2,
      {
        volumeL:
          hydraulicState
            .totalVolumeThroughTanksL,

        inletTemperatureC:
          d1Flow
            .actualOutletTemperatureC,

        requestedOutletTemperatureC:
          tank2.outletTemperatureC
      }
    );

  const totalRequestedEnergyKWh =
    d1Flow.requestedEnergyKWh +
    d2Flow.requestedEnergyKWh;

  const totalDeliveredEnergyKWh =
    d1Flow.deliveredEnergyKWh +
    d2Flow.deliveredEnergyKWh;

  return {
    systemType: "two-tank",

    hydraulicBalance,

    d1Inlet,
    d1Flow,
    d2Flow,

    finalOutletTemperatureC:
      d2Flow.actualOutletTemperatureC,

    tankDeliveredEnergyKWh:
      totalDeliveredEnergyKWh,

    tankRequestedEnergyKWh:
      totalRequestedEnergyKWh,

    tankUnavailableEnergyKWh:
      Math.max(
        0,
        totalRequestedEnergyKWh -
          totalDeliveredEnergyKWh
      )
  };
}

/**
 * Resuelve una pasada hidráulica utilizando uno o dos depósitos
 * según la configuración.
 *
 * Esta función todavía no realiza la iteración completa del minuto.
 * Esa convergencia se implementará en el Bloque 4.
 *
 * @param {object} params
 * @param {object} params.config Configuración normalizada.
 * @param {ACSTank[]} params.tanks
 * @param {ACSMinuteHydraulicState|object} params.hydraulicState
 *
 * @returns {object}
 */
function resolveHydraulicPass(params) {
  const {
    config,
    tanks,
    hydraulicState
  } = params;

  if (
    !config ||
    typeof config !== "object"
  ) {
    throw new ACSSimulationError(
      "config es obligatorio."
    );
  }

  if (!Array.isArray(tanks)) {
    throw new ACSSimulationError(
      "tanks debe ser un array."
    );
  }

  if (
    tanks.length !==
    config.tankCount
  ) {
    throw new ACSSimulationError(
      "El número de depósitos no coincide con la configuración.",
      {
        tankCount:
          config.tankCount,

        receivedTanks:
          tanks.length
      }
    );
  }

  if (config.tankCount === 1) {
    return resolveSingleTankHydraulicPass({
      tank: tanks[0],
      hydraulicState
    });
  }

  if (config.tankCount === 2) {
    return resolveTwoTankHydraulicPass({
      tank1: tanks[0],
      tank2: tanks[1],
      hydraulicState
    });
  }

  throw new ACSSimulationError(
    "Solo se admiten instalaciones de uno o dos depósitos."
  );
}

/**
 * Crea una copia independiente del conjunto de depósitos.
 *
 * Se utilizará en el proceso iterativo para probar un estado sin
 * modificar todavía el estado definitivo de la simulación.
 *
 * @param {ACSTank[]} tanks
 * @returns {ACSTank[]}
 */
function cloneTanks(tanks) {
  if (!Array.isArray(tanks)) {
    throw new ACSSimulationError(
      "tanks debe ser un array."
    );
  }

  return tanks.map(
    (tank, index) => {
      if (!(tank instanceof ACSTank)) {
        throw new ACSSimulationError(
          `tanks[${index}] no es una instancia de ACSTank.`
        );
      }

      return tank.clone();
    }
  );
}

/**
 * Copia el estado energético de unos depósitos a otros.
 *
 * @param {ACSTank[]} sourceTanks
 * @param {ACSTank[]} targetTanks
 */
function copyTankStates(
  sourceTanks,
  targetTanks
) {
  if (
    !Array.isArray(sourceTanks) ||
    !Array.isArray(targetTanks)
  ) {
    throw new ACSSimulationError(
      "sourceTanks y targetTanks deben ser arrays."
    );
  }

  if (
    sourceTanks.length !==
    targetTanks.length
  ) {
    throw new ACSSimulationError(
      "Los arrays de depósitos deben tener la misma longitud."
    );
  }

  sourceTanks.forEach(
    (sourceTank, index) => {
      const targetTank =
        targetTanks[index];

      if (
        !(sourceTank instanceof ACSTank) ||
        !(targetTank instanceof ACSTank)
      ) {
        throw new ACSSimulationError(
          "Todos los elementos deben ser instancias de ACSTank."
        );
      }

      targetTank.energyKWh =
        sourceTank.energyKWh;

      targetTank.normalizeState();
    }
  );
}

/**
 * Restaura la energía de los depósitos desde una colección de estados.
 *
 * @param {ACSTank[]} tanks
 * @param {object[]} states
 */
function restoreTankStates(
  tanks,
  states
) {
  if (
    !Array.isArray(tanks) ||
    !Array.isArray(states)
  ) {
    throw new ACSSimulationError(
      "tanks y states deben ser arrays."
    );
  }

  if (tanks.length !== states.length) {
    throw new ACSSimulationError(
      "El número de estados no coincide con el número de depósitos."
    );
  }

  tanks.forEach((tank, index) => {
    if (!(tank instanceof ACSTank)) {
      throw new ACSSimulationError(
        `tanks[${index}] no es una instancia de ACSTank.`
      );
    }

    const state = states[index];

    if (
      !state ||
      !isFiniteNumber(state.energyKWh)
    ) {
      throw new ACSSimulationError(
        `states[${index}] no contiene una energía válida.`
      );
    }

    tank.energyKWh =
      state.energyKWh;

    tank.normalizeState();
  });
}

/**
 * Obtiene una instantánea del conjunto de depósitos.
 *
 * @param {ACSTank[]} tanks
 * @returns {object[]}
 */
function getTankStates(tanks) {
  if (!Array.isArray(tanks)) {
    throw new ACSSimulationError(
      "tanks debe ser un array."
    );
  }

  return tanks.map(
    (tank, index) => {
      if (!(tank instanceof ACSTank)) {
        throw new ACSSimulationError(
          `tanks[${index}] no es una instancia de ACSTank.`
        );
      }

      return tank.getState();
    }
  );
}

/**
 * Calcula la energía total almacenada en todos los depósitos.
 *
 * @param {ACSTank[]} tanks
 * @returns {number}
 */
function calculateTotalStoredEnergyKWh(
  tanks
) {
  if (!Array.isArray(tanks)) {
    throw new ACSSimulationError(
      "tanks debe ser un array."
    );
  }

  return tanks.reduce(
    (total, tank, index) => {
      if (!(tank instanceof ACSTank)) {
        throw new ACSSimulationError(
          `tanks[${index}] no es una instancia de ACSTank.`
        );
      }

      return total + tank.energyKWh;
    },
    0
  );
}

/**
 * Crea los depósitos de la simulación desde la configuración
 * normalizada.
 *
 * Los depósitos comienzan siempre al 100 % de carga.
 *
 * @param {object} config
 * @returns {ACSTank[]}
 */
function createSimulationTanks(config) {
  if (
    !config ||
    typeof config !== "object"
  ) {
    throw new ACSSimulationError(
      "config es obligatorio."
    );
  }

  if (!Array.isArray(config.tanks)) {
    throw new ACSSimulationError(
      "config.tanks debe ser un array."
    );
  }

  return config.tanks.map(
    tankConfig =>
      new ACSTank({
        ...tankConfig,
        initialLoadPercent: 100
      })
  );
}

/**
 * Ejecuta una única pasada hidráulica provisional.
 *
 * Los depósitos originales no se modifican.
 *
 * Esta función resulta útil para el proceso iterativo:
 *
 * 1. Se clonan los depósitos.
 * 2. Se calcula el estado hidráulico provisional.
 * 3. Se obtiene una temperatura de salida.
 * 4. Se repite hasta alcanzar convergencia.
 *
 * @param {object} params
 * @param {object} params.config
 * @param {ACSTank[]} params.tanks
 * @param {number} params.minuteIndex
 * @param {number} params.assumedOutletTemperatureC
 *
 * @returns {{
 *   provisionalTanks: ACSTank[],
 *   hydraulicState: ACSMinuteHydraulicState,
 *   hydraulicResult: object
 * }}
 */
function simulateProvisionalHydraulicPass(
  params
) {
  const {
    config,
    tanks,
    minuteIndex,
    assumedOutletTemperatureC
  } = params;

  requireNonNegativeNumber(
    minuteIndex,
    "minuteIndex"
  );

  requireFiniteNumber(
    assumedOutletTemperatureC,
    "assumedOutletTemperatureC"
  );

  const provisionalTanks =
    cloneTanks(tanks);

  const hydraulicState =
    createMinuteHydraulicState(
      config,
      minuteIndex,
      assumedOutletTemperatureC
    );

  const hydraulicResult =
    resolveHydraulicPass({
      config,
      tanks: provisionalTanks,
      hydraulicState
    });

  return {
    provisionalTanks,
    hydraulicState,
    hydraulicResult
  };
}

/**
 * ============================================================
 * ACTUALIZACIÓN DE EXPORTACIONES
 * ============================================================
 */

const ACSBlock3 = {
  mixWaterStreams,

  calculateTankFlowEnergyKWh,
  calculateOutletTemperatureFromEnergy,

  processFlowThroughTank,

  calculateD1Inlet,
  validateMinuteHydraulicBalance,

  resolveSingleTankHydraulicPass,
  resolveTwoTankHydraulicPass,
  resolveHydraulicPass,

  cloneTanks,
  copyTankStates,
  restoreTankStates,
  getTankStates,

  calculateTotalStoredEnergyKWh,
  createSimulationTanks,

  simulateProvisionalHydraulicPass
};

/**
 * Node.js
 */
if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = {
    ...module.exports,
    ...ACSBlock3
  };
}

/**
 * Navegador
 */
if (typeof window !== "undefined") {
  window.ACSBlock3 = ACSBlock3;

  window.ACS = {
    ...(window.ACS || {}),
    ...(window.ACSBlock1 || {}),
    ...(window.ACSBlock2 || {}),
    ...ACSBlock3
  };
}

/**
 * ============================================================
 * BLOQUE 4
 * Resolución iterativa del minuto y control del generador
 * ============================================================
 *
 * Requiere que los bloques 1, 2 y 3 estén definidos antes.
 *
 * Integración de intercambiadores:
 * - Placas: potencia efectiva = potencia nominal.
 * - Serpentín: la potencia efectiva se obtiene dinámicamente
 *   desde ACSTank.effectiveExchangerPowerKW.
 */

/**
 * Determina qué depósito gobierna la temperatura de salida
 * de la instalación.
 *
 * - Un depósito: D1.
 * - Dos depósitos: D2.
 */
function getOutletTank(config, tanks) {
  if (
    !config ||
    typeof config !== "object"
  ) {
    throw new ACSSimulationError(
      "config es obligatorio."
    );
  }

  if (!Array.isArray(tanks)) {
    throw new ACSSimulationError(
      "tanks debe ser un array."
    );
  }

  if (config.tankCount === 1) {
    return tanks[0];
  }

  if (config.tankCount === 2) {
    return tanks[1];
  }

  throw new ACSSimulationError(
    "Solo se admiten uno o dos depósitos."
  );
}

/**
 * Obtiene la temperatura de salida de la instalación.
 */
function getSystemOutletTemperatureC(
  config,
  tanks
) {
  return getOutletTank(
    config,
    tanks
  ).outletTemperatureC;
}

/**
 * Devuelve un resumen del estado instantáneo del intercambiador.
 *
 * Sirve para almacenar en cada minuto:
 * - tipo;
 * - potencia nominal;
 * - potencia efectiva;
 * - factor de corrección;
 * - estado térmico de la zona inferior.
 */
function getTankExchangerDiagnostic(
  tank
) {
  if (!(tank instanceof ACSTank)) {
    throw new ACSSimulationError(
      "tank debe ser una instancia de ACSTank."
    );
  }

  return {
    tankId:
      tank.id,

    exchangerType:
      tank.exchangerType,

    nominalExchangerPowerKW:
      tank.exchangerPowerKW,

    effectiveExchangerPowerKW:
      tank.effectiveExchangerPowerKW,

    thermalCorrectionFactor:
      tank.thermalCorrectionFactor,

    nominalPrimaryInletTemperatureC:
      tank.nominalPrimaryInletTemperatureC,

    nominalPrimaryOutletTemperatureC:
      tank.nominalPrimaryOutletTemperatureC,

    nominalPrimaryMeanTemperatureC:
      tank.nominalPrimaryMeanTemperatureC,

    nominalSecondaryInletTemperatureC:
      tank.nominalSecondaryInletTemperatureC,

    nominalSecondaryOutletTemperatureC:
      tank.nominalSecondaryOutletTemperatureC,

    nominalSecondaryMeanTemperatureC:
      tank.nominalSecondaryMeanTemperatureC,

    nominalTemperatureDifferenceC:
      tank.nominalTemperatureDifferenceC,

    actualPrimaryInletTemperatureC:
      tank.actualPrimaryInletTemperatureC,

    actualPrimaryOutletTemperatureC:
      tank.actualPrimaryOutletTemperatureC,

    actualPrimaryMeanTemperatureC:
      tank.actualPrimaryMeanTemperatureC,

    actualTemperatureDifferenceC:
      tank.actualTemperatureDifferenceC,

    lowerZoneLoadPercent:
      tank.lowerZoneLoadPercent,

    lowerZoneTemperatureC:
      tank.lowerZoneTemperatureC,

    tankLoadPercent:
      tank.loadPercent
  };
}

/**
 * Estado del generador.
 */
class ACSGeneratorState {
  constructor() {
    this.running = false;

    this.startCount = 0;
    this.stopCount = 0;

    this.totalRunningMinutes = 0;

    this.lastStartMinute = null;
    this.lastStopMinute = null;

    /* Potencia térmica efectiva al final del último subintervalo. */
    this.currentPowerKW = 0;

    /*
     * Tiempo consecutivo durante el cual el generador ha trabajado por
     * debajo de su potencia mínima estable cuando no existe inercia
     * suficiente. Se integra con la misma resolución subminuto que el
     * balance energético.
     */
    this.belowMinimumPowerMinutes = 0;

    this.minimumPowerForcedStopCount = 0;
  }

  /**
   * Devuelve una copia independiente.
   */
  clone() {
    const copy =
      new ACSGeneratorState();

    copy.running =
      this.running;

    copy.startCount =
      this.startCount;

    copy.stopCount =
      this.stopCount;

    copy.totalRunningMinutes =
      this.totalRunningMinutes;

    copy.lastStartMinute =
      this.lastStartMinute;

    copy.lastStopMinute =
      this.lastStopMinute;

    copy.currentPowerKW =
      this.currentPowerKW;

    copy.belowMinimumPowerMinutes =
      this.belowMinimumPowerMinutes;

    copy.minimumPowerForcedStopCount =
      this.minimumPowerForcedStopCount;

    return copy;
  }

  /**
   * Devuelve una instantánea serializable.
   */
  getState() {
    return {
      running:
        this.running,

      startCount:
        this.startCount,

      stopCount:
        this.stopCount,

      totalRunningMinutes:
        this.totalRunningMinutes,

      lastStartMinute:
        this.lastStartMinute,

      lastStopMinute:
        this.lastStopMinute,

      currentPowerKW:
        this.currentPowerKW,

      belowMinimumPowerMinutes:
        this.belowMinimumPowerMinutes,

      minimumPowerForcedStopCount:
        this.minimumPowerForcedStopCount
    };
  }
}

/**
 * Decide el estado del generador al comienzo de un minuto.
 *
 * Un depósito:
 * - Arranca al bajar del porcentaje configurado.
 * - Para al alcanzar el 100 %.
 *
 * Dos depósitos:
 * - Arranca cuando cualquiera baja del umbral.
 * - Para solo cuando ambos alcanzan el 100 %.
 */
function updateGeneratorControlAtMinuteStart(
  params
) {
  const {
    config,
    tanks,
    generatorState,
    minuteIndex
  } = params;

  if (
    !config ||
    typeof config !== "object"
  ) {
    throw new ACSSimulationError(
      "config es obligatorio."
    );
  }

  if (!Array.isArray(tanks)) {
    throw new ACSSimulationError(
      "tanks debe ser un array."
    );
  }

  if (
    !(generatorState instanceof
      ACSGeneratorState)
  ) {
    throw new ACSSimulationError(
      "generatorState debe ser una instancia de ACSGeneratorState."
    );
  }

  requireNonNegativeNumber(
    minuteIndex,
    "minuteIndex"
  );

  const previousRunning =
    generatorState.running;

  const threshold =
    config.startThresholdPercent;

  const anyTankBelowThreshold =
    tanks.some(
      tank =>
        tank.loadPercent <
        threshold
    );

  const allTanksFull =
    tanks.every(
      tank =>
        tank.isFull ||
        tank.loadPercent >= 99.999
    );

  let nextRunning =
    previousRunning;

  let reason =
    "Estado mantenido.";

  if (!previousRunning) {
    const minimumStartIntervalMinutes =
      Math.max(
        0,
        Number(
          config.minimumGeneratorStartIntervalMinutes || 0
        )
      );

    const startIntervalSatisfied =
      generatorState.lastStartMinute === null ||
      minuteIndex - generatorState.lastStartMinute >=
        minimumStartIntervalMinutes;

    if (
      anyTankBelowThreshold &&
      config.generatorPowerKW > 0 &&
      startIntervalSatisfied
    ) {
      nextRunning = true;

      reason =
        "Arranque por depósito bajo el umbral.";
    } else if (
      anyTankBelowThreshold &&
      config.generatorPowerKW > 0 &&
      !startIntervalSatisfied
    ) {
      reason =
        "Arranque bloqueado por intervalo mínimo entre arranques.";
    }
  } else if (allTanksFull) {
    nextRunning = false;

    reason =
      "Parada por depósitos completamente cargados.";
  }

  const started =
    !previousRunning &&
    nextRunning;

  const stopped =
    previousRunning &&
    !nextRunning;

  generatorState.running =
    nextRunning;

  if (started) {
    generatorState.startCount += 1;

    generatorState.lastStartMinute =
      minuteIndex;

    generatorState.belowMinimumPowerMinutes = 0;
  }

  if (stopped) {
    generatorState.stopCount += 1;

    generatorState.lastStopMinute =
      minuteIndex;

    generatorState.currentPowerKW = 0;
    generatorState.belowMinimumPowerMinutes = 0;
  }

  return {
    previousRunning,
    running:
      nextRunning,
    started,
    stopped,
    reason
  };
}

/**
 * Distribuye la potencia del generador entre los depósitos.
 *
 * Un depósito:
 * - Recibe como máximo:
 *   - Potencia del generador.
 *   - Potencia efectiva del intercambiador.
 *   - Potencia absorbible antes de llenarse.
 *
 * Dos depósitos en paralelo:
 * - D2 conserva prioridad sobre D1.
 * - Cuando D1 está calentando, D2 modula de forma instantánea para cubrir
 *   su extracción hidráulica y recuperar hasta Tacum.
 * - D1 recibe después la potencia restante y mantiene control todo/nada.
 * - Cuando D1 no está calentando, D2 conserva el control todo/nada existente.
 * - No se reconstruyen potencias medias para la cronología.
 *
 * La potencia efectiva del intercambiador se consulta en el instante
 * anterior a la carga del minuto. Para serpentines depende de:
 * - porcentaje de carga;
 * - temperatura estimada del tercio inferior;
 * - condiciones nominales;
 * - condiciones reales del primario.
 */
function applyGeneratorForMinute(
  params
) {
  const {
    config,
    tanks,
    generatorState,
    intervalMinutes = 1,

    /**
     * Energía extraída hidráulicamente de cada depósito durante este mismo
     * subintervalo. Sólo se utiliza para el control modulante explícito de
     * D2 cuando D1 está calentando.
     */
    hydraulicExtractedEnergyKWhByTank = null
  } = params;

  if (
    !config ||
    typeof config !== "object"
  ) {
    throw new ACSSimulationError(
      "config es obligatorio."
    );
  }

  if (!Array.isArray(tanks)) {
    throw new ACSSimulationError(
      "tanks debe ser un array."
    );
  }

  if (
    !(generatorState instanceof
      ACSGeneratorState)
  ) {
    throw new ACSSimulationError(
      "generatorState debe ser una instancia de ACSGeneratorState."
    );
  }

  requirePositiveNumber(
    intervalMinutes,
    "intervalMinutes"
  );

  const hydraulicExtractionByTank =
    Array.isArray(
      hydraulicExtractedEnergyKWhByTank
    )
      ? tanks.map(
          (tank, tankIndex) =>
            Math.max(
              0,
              Number(
                hydraulicExtractedEnergyKWhByTank[
                  tankIndex
                ] || 0
              )
            )
        )
      : tanks.map(() => 0);

  /**
   * Diagnóstico previo a la aplicación de potencia.
   *
   * Es especialmente importante para el serpentín, porque después
   * de absorber energía puede cambiar su factor térmico.
   */
  const initialExchangerDiagnostics =
    tanks.map(
      tank =>
        getTankExchangerDiagnostic(
          tank
        )
    );

  if (
    !generatorState.running ||
    config.generatorPowerKW <= 0
  ) {
    generatorState.currentPowerKW = 0;
    generatorState.belowMinimumPowerMinutes = 0;

    return {
      generatorRunning: false,
      generatorDemandActive: false,

      nominalGeneratorPowerKW:
        config.generatorPowerKW,

      generatorPowerKW: 0,
      effectivePowerKW: 0,

      hasSufficientGeneratorInertia:
        config.hasSufficientGeneratorInertia,
      generatorMinimumPowerKW:
        config.generatorMinimumPowerKW,
      maximumBelowMinimumPowerMinutes:
        config.maximumBelowMinimumPowerMinutes,
      belowMinimumPowerMinutes: 0,
      minimumPowerStopRequired: false,

      requestedEnergyKWh: 0,
      absorbedEnergyKWh: 0,
      unusedEnergyKWh: 0,

      initialExchangerDiagnostics,

      finalExchangerDiagnostics:
        initialExchangerDiagnostics.map(
          item =>
            cloneObject(item)
        ),

      tankResults:
        tanks.map(
          tank => {
            const diagnostic =
              getTankExchangerDiagnostic(
                tank
              );

            return {
              tankId:
                tank.id,

              exchangerType:
                tank.exchangerType,

              nominalExchangerPowerKW:
                tank.exchangerPowerKW,

              availableExchangerPowerKW:
                tank
                  .effectiveExchangerPowerKW,

              thermalCorrectionFactor:
                tank
                  .thermalCorrectionFactor,

              assignedPowerKW: 0,
              effectivePowerKW: 0,
              absorbedEnergyKWh: 0,
              effectiveMinutes: 0,

              initialExchangerDiagnostic:
                diagnostic,

              finalExchangerDiagnostic:
                cloneObject(
                  diagnostic
                ),

              finalTankState:
                tank.getState()
            };
          }
        )
    };
  }

  /* Se completa después de calcular la potencia disponible por rampa. */
  let requestedEnergyKWh = 0;

  const rampMinutes =
    Math.max(
      0,
      Number(
        config.generatorRampMinutes || 0
      )
    );

  const previousGeneratorPowerKW =
    Math.max(
      0,
      Number(
        generatorState.currentPowerKW || 0
      )
    );

  /*
   * La rampa limita la velocidad de subida desde la potencia efectiva
   * actual hacia el siguiente estado solicitado. La reducción de potencia
   * sigue inmediatamente a la capacidad real de absorción para no crear
   * energía sobrante ni modificar el balance existente.
   */
  const maximumPowerIncreaseKW =
    rampMinutes > 0
      ? config.generatorPowerKW *
        intervalMinutes /
        rampMinutes
      : config.generatorPowerKW;

  const rampLimitedGeneratorPowerKW =
    rampMinutes > 0
      ? Math.min(
          config.generatorPowerKW,
          previousGeneratorPowerKW +
            maximumPowerIncreaseKW
        )
      : config.generatorPowerKW;

  let remainingPowerKW =
    rampLimitedGeneratorPowerKW;

  requestedEnergyKWh =
    powerToEnergy(
      rampLimitedGeneratorPowerKW,
      intervalMinutes
    );

  /**
   * Un depósito:
   * D1
   *
   * Dos depósitos:
   * D2 primero y después D1
   */
  const priorityOrder =
    config.tankCount === 2
      ? [
          {
            tank:
              tanks[1],
            originalIndex: 1
          },
          {
            tank:
              tanks[0],
            originalIndex: 0
          }
        ]
      : [
          {
            tank:
              tanks[0],
            originalIndex: 0
          }
        ];

  const temporaryResults =
    new Array(tanks.length);

  /**
   * En la arquitectura de dos depósitos, D1 continúa siendo todo/nada.
   * Se considera que D1 está calentando cuando, durante este subintervalo,
   * necesita recuperar energía hasta Tacum después de considerar la
   * extracción hidráulica simultánea.
   *
   * Esta condición habilita el control modulante de D2. En la arquitectura
   * de un solo depósito no se evalúa ni se modifica esta lógica.
   */
  const d1HeatingActive =
    config.tankCount === 2 &&
    tanks.length >= 2 &&
    (
      tanks[0].remainingCapacityKWh +
      hydraulicExtractionByTank[0]
    ) > ACS_CONSTANTS.DEFAULT_CONVERGENCE_TOLERANCE;

  priorityOrder.forEach(
    item => {
      const {
        tank,
        originalIndex
      } = item;

      /**
       * Estado antes de cargar el depósito.
       */
      const initialExchangerDiagnostic =
        getTankExchangerDiagnostic(
          tank
        );

      /**
       * `maximumAbsorbablePowerKW` se conserva como diagnóstico energético:
       * expresa la potencia media equivalente que llenaría exactamente la
       * capacidad restante durante todo el intervalo.
       *
       * No debe utilizarse como potencia instantánea, porque eso convertiría
       * una parada parcial del intercambiador en una modulación artificial.
       */
      const maximumAbsorbablePowerKW =
        tank.getMaximumAbsorbablePowerKW(
          intervalMinutes
        );

      let controlExchangerDiagnostic =
        initialExchangerDiagnostic;

      const isD2 =
        config.tankCount === 2 &&
        originalIndex === 1;

      /**
       * D2 modulante en paralelo:
       *
       * Cuando D1 está calentando, D2 tiene prioridad y recibe únicamente la
       * potencia instantánea necesaria para:
       * - compensar la energía que consumo y pérdidas extraen de D2 durante
       *   este mismo subintervalo;
       * - recuperar cualquier déficit previo hasta Tacum;
       * - sin superar la potencia efectiva de su intercambiador ni la
       *   potencia disponible del generador.
       *
       * La extracción hidráulica se aplica virtualmente a la copia de D2
       * antes de cargarla. Esto crea la capacidad real que D2 debe compensar
       * en el balance simultáneo y permite que `applyPower()` registre esa
       * potencia como un estado instantáneo continuo, no como una media
       * reconstruida para la gráfica.
       */
      const d2Modulating =
        isD2 && d1HeatingActive;

      if (d2Modulating) {
        const simultaneousExtractionKWh =
          hydraulicExtractionByTank[
            originalIndex
          ];

        if (simultaneousExtractionKWh > 0) {
          tank.extractEnergy(
            simultaneousExtractionKWh
          );

          /**
           * En serpentines, la extracción simultánea puede modificar la
           * corrección térmica. La potencia disponible se vuelve a evaluar
           * sobre el estado instantáneo que realmente debe recuperar D2.
           */
          controlExchangerDiagnostic =
            getTankExchangerDiagnostic(
              tank
            );
        }
      }

      const availableExchangerPowerKW =
        Math.max(
          0,
          controlExchangerDiagnostic
            ?.effectiveExchangerPowerKW || 0
        );

      const instantaneousRequiredPowerKW =
        d2Modulating
          ? (
              tank.remainingCapacityKWh *
              ACS_CONSTANTS.MINUTES_PER_HOUR /
              intervalMinutes
            )
          : availableExchangerPowerKW;

      const assignedPowerKW =
        Math.min(
          remainingPowerKW,
          availableExchangerPowerKW,
          Math.max(
            0,
            instantaneousRequiredPowerKW
          )
        );

      /**
       * D2 conserva la prioridad: su consigna modulante se descuenta primero.
       * D1 recibe después la potencia restante y continúa trabajando como
       * todo/nada.
       */
      remainingPowerKW -=
        assignedPowerKW;

      const result =
        tank.applyPower(
          assignedPowerKW,
          intervalMinutes
        );

      /**
       * Estado después de cargar el depósito.
       *
       * En serpentines puede mostrar un factor térmico distinto
       * por el aumento de carga del tercio inferior.
       */
      const finalExchangerDiagnostic =
        getTankExchangerDiagnostic(
          tank
        );

      temporaryResults[
        originalIndex
      ] = {
        tankId:
          tank.id,

        exchangerType:
          tank.exchangerType,

        nominalExchangerPowerKW:
          tank.exchangerPowerKW,

        availableExchangerPowerKW:
          result.availableExchangerPowerKW,

        maximumAbsorbablePowerKW,

        controlMode:
          d2Modulating
            ? "modulating-parallel-d2"
            : "on-off",

        d1HeatingActive,

        hydraulicCompensationEnergyKWh:
          d2Modulating
            ? hydraulicExtractionByTank[
                originalIndex
              ]
            : 0,

        instantaneousRequiredPowerKW,

        thermalCorrectionFactor:
          result.thermalCorrectionFactor,

        assignedPowerKW,

        effectivePowerKW:
          result.effectivePowerKW,

        absorbedEnergyKWh:
          result.absorbedEnergyKWh,

        effectiveMinutes:
          result.effectiveMinutes,

        initialExchangerDiagnostic,

        finalExchangerDiagnostic,

        finalTankState:
          tank.getState()
      };
    }
  );

  const tankResults =
    temporaryResults;

  const absorbedEnergyKWh =
    tankResults.reduce(
      (
        total,
        item
      ) =>
        total +
        item.absorbedEnergyKWh,
      0
    );

  const unusedEnergyKWh =
    Math.max(
      0,
      requestedEnergyKWh -
        absorbedEnergyKWh
    );

  const effectivePowerKW =
    intervalMinutes > 0
      ? absorbedEnergyKWh *
        ACS_CONSTANTS.MINUTES_PER_HOUR /
        intervalMinutes
      : 0;

  if (effectivePowerKW > 0) {
    generatorState.totalRunningMinutes +=
      intervalMinutes;
  }

  generatorState.currentPowerKW =
    Math.max(
      0,
      Math.min(
        config.generatorPowerKW,
        effectivePowerKW
      )
    );

  const hasSufficientGeneratorInertia =
    config.hasSufficientGeneratorInertia !== false;

  const generatorMinimumPowerKW =
    Math.max(
      0,
      Number(
        config.generatorMinimumPowerKW || 0
      )
    );

  const maximumBelowMinimumPowerMinutes =
    Math.max(
      0,
      Number(
        config.maximumBelowMinimumPowerMinutes || 0
      )
    );

  const operatingBelowMinimum =
    !hasSufficientGeneratorInertia &&
    generatorMinimumPowerKW > 0 &&
    generatorState.running &&
    effectivePowerKW <
      generatorMinimumPowerKW - 1e-12;

  if (operatingBelowMinimum) {
    generatorState.belowMinimumPowerMinutes +=
      intervalMinutes;
  } else {
    generatorState.belowMinimumPowerMinutes = 0;
  }

  const minimumPowerStopRequired =
    operatingBelowMinimum &&
    generatorState.belowMinimumPowerMinutes + 1e-12 >=
      maximumBelowMinimumPowerMinutes;

  return {
    generatorRunning:
      effectivePowerKW > 0,

    generatorDemandActive: true,

    nominalGeneratorPowerKW:
      config.generatorPowerKW,

    rampLimitedGeneratorPowerKW,
    previousGeneratorPowerKW,

    generatorPowerKW:
      effectivePowerKW,

    effectivePowerKW,

    hasSufficientGeneratorInertia,
    generatorMinimumPowerKW,
    maximumBelowMinimumPowerMinutes,
    operatingBelowMinimum,
    belowMinimumPowerMinutes:
      generatorState.belowMinimumPowerMinutes,
    minimumPowerStopRequired,

    /*
     * En este modelo simplificado el generador entrega exactamente
     * la energía que absorben los intercambiadores. No existe energía
     * sobrante ni rechazada.
     */
    requestedEnergyKWh:
      absorbedEnergyKWh,

    absorbedEnergyKWh,

    unusedEnergyKWh: 0,

    initialExchangerDiagnostics,

    finalExchangerDiagnostics:
      tanks.map(
        tank =>
          getTankExchangerDiagnostic(
            tank
          )
      ),

    tankResults
  };
}

/**
 * Comprueba si dos valores han convergido.
 */
function hasConverged(
  previousValue,
  nextValue,
  tolerance
) {
  requireFiniteNumber(
    previousValue,
    "previousValue"
  );

  requireFiniteNumber(
    nextValue,
    "nextValue"
  );

  requireNonNegativeNumber(
    tolerance,
    "tolerance"
  );

  return (
    Math.abs(
      nextValue -
      previousValue
    ) <= tolerance
  );
}

/**
 * Calcula una temperatura de salida relajada para estabilizar
 * la iteración.
 */
function relaxTemperature(
  previousTemperatureC,
  calculatedTemperatureC,
  relaxationFactor
) {
  requireFiniteNumber(
    previousTemperatureC,
    "previousTemperatureC"
  );

  requireFiniteNumber(
    calculatedTemperatureC,
    "calculatedTemperatureC"
  );

  requireNumberInRange(
    relaxationFactor,
    0,
    1,
    "relaxationFactor"
  );

  return (
    relaxationFactor *
      calculatedTemperatureC +
    (
      1 -
      relaxationFactor
    ) *
      previousTemperatureC
  );
}

/**
 * Resuelve iterativamente la parte hidráulica y energética del minuto.
 */
function resolveMinuteIteratively(
  params
) {
  const {
    config,
    tanks,
    minuteIndex,

    tolerance =
      ACS_CONSTANTS
        .DEFAULT_CONVERGENCE_TOLERANCE,

    maxIterations =
      ACS_CONSTANTS
        .DEFAULT_MAX_ITERATIONS,

    relaxationFactor = 0.5
  } = params;

  if (
    !config ||
    typeof config !== "object"
  ) {
    throw new ACSSimulationError(
      "config es obligatorio."
    );
  }

  if (!Array.isArray(tanks)) {
    throw new ACSSimulationError(
      "tanks debe ser un array."
    );
  }

  requireNonNegativeNumber(
    minuteIndex,
    "minuteIndex"
  );

  requirePositiveNumber(
    maxIterations,
    "maxIterations"
  );

  requireNonNegativeNumber(
    tolerance,
    "tolerance"
  );

  requireNumberInRange(
    relaxationFactor,
    0,
    1,
    "relaxationFactor"
  );

  const initialTankStates =
    getTankStates(tanks);

  const initialOutletTemperatureC =
    getSystemOutletTemperatureC(
      config,
      tanks
    );

  let assumedOutletTemperatureC =
    initialOutletTemperatureC;

  let converged = false;
  let iterations = 0;

  let finalProvisionalTanks = null;
  let finalHydraulicState = null;
  let finalHydraulicResult = null;

  for (
    let iteration = 1;
    iteration <= maxIterations;
    iteration += 1
  ) {
    iterations = iteration;

    const provisional =
      simulateProvisionalHydraulicPass({
        config,
        tanks,
        minuteIndex,
        assumedOutletTemperatureC
      });

    const calculatedOutletTemperatureC =
      provisional
        .hydraulicResult
        .finalOutletTemperatureC;

    finalProvisionalTanks =
      provisional.provisionalTanks;

    finalHydraulicState =
      provisional.hydraulicState;

    finalHydraulicResult =
      provisional.hydraulicResult;

    if (
      hasConverged(
        assumedOutletTemperatureC,
        calculatedOutletTemperatureC,
        tolerance
      )
    ) {
      assumedOutletTemperatureC =
        calculatedOutletTemperatureC;

      converged = true;
      break;
    }

    assumedOutletTemperatureC =
      relaxTemperature(
        assumedOutletTemperatureC,
        calculatedOutletTemperatureC,
        relaxationFactor
      );
  }

  if (!finalProvisionalTanks) {
    throw new ACSSimulationError(
      "No se ha podido resolver el minuto."
    );
  }

  /**
   * Se acepta el último estado obtenido incluso si no se ha alcanzado
   * convergencia estricta.
   */
  copyTankStates(
    finalProvisionalTanks,
    tanks
  );

  return {
    converged,
    iterations,

    initialOutletTemperatureC,

    finalOutletTemperatureC:
      finalHydraulicResult
        .finalOutletTemperatureC,

    assumedOutletTemperatureC,

    hydraulicState:
      finalHydraulicState.getState(),

    hydraulicResult:
      cloneObject(
        finalHydraulicResult
      ),

    initialTankStates,

    finalTankStates:
      getTankStates(tanks)
  };
}

/**
 * Calcula el tiempo sanitario por debajo de 60 °C.
 *
 * - Un depósito: D1.
 * - Dos depósitos: D2.
 */
function calculateSanitaryStatus(
  params
) {
  const {
    config,
    tanks,
    intervalMinutes = 1
  } = params;

  requirePositiveNumber(
    intervalMinutes,
    "intervalMinutes"
  );

  if (!config.sanitaryCheck) {
    return {
      enabled: false,
      evaluatedTankId: null,
      temperatureC: null,
      below60C: false,
      minutesBelow60C: 0
    };
  }

  const evaluatedTank =
    getOutletTank(
      config,
      tanks
    );

  const temperatureC =
    evaluatedTank
      .averageTemperatureC;

  const below60C =
    temperatureC < 59.99

  return {
    enabled: true,

    evaluatedTankId:
      evaluatedTank.id,

    temperatureC,

    below60C,

    minutesBelow60C:
      below60C
        ? intervalMinutes
        : 0
  };
}


/**
 * Combina dos aplicaciones parciales del generador realizadas dentro
 * del mismo minuto.
 *
 * Se utiliza para integrar el balance energético con un esquema
 * simétrico de punto medio:
 *
 * 1. media generación;
 * 2. transporte hidráulico del minuto;
 * 3. media generación.
 *
 * De esta forma generación y extracción se consideran simultáneas
 * dentro del intervalo, evitando el sesgo de descargar completamente
 * antes de cargar o de cargar completamente antes de descargar.
 */
function combinePartialGenerationResults(
  firstGeneration,
  secondGeneration,
  totalIntervalMinutes = 1
) {
  requirePositiveNumber(
    totalIntervalMinutes,
    "totalIntervalMinutes"
  );

  const tankCount =
    Math.max(
      firstGeneration.tankResults.length,
      secondGeneration.tankResults.length
    );

  const tankResults =
    new Array(tankCount);

  for (
    let tankIndex = 0;
    tankIndex < tankCount;
    tankIndex += 1
  ) {
    const first =
      firstGeneration.tankResults[tankIndex];

    const second =
      secondGeneration.tankResults[tankIndex];

    const absorbedEnergyKWh =
      (first?.absorbedEnergyKWh || 0) +
      (second?.absorbedEnergyKWh || 0);

    const effectiveMinutes =
      (first?.effectiveMinutes || 0) +
      (second?.effectiveMinutes || 0);

    tankResults[tankIndex] = {
      tankId:
        first?.tankId ??
        second?.tankId,

      exchangerType:
        first?.exchangerType ??
        second?.exchangerType,

      nominalExchangerPowerKW:
        first?.nominalExchangerPowerKW ??
        second?.nominalExchangerPowerKW ??
        0,

      availableExchangerPowerKW:
        first?.availableExchangerPowerKW ??
        second?.availableExchangerPowerKW ??
        0,

      maximumAbsorbablePowerKW:
        Math.max(
          first?.maximumAbsorbablePowerKW || 0,
          second?.maximumAbsorbablePowerKW || 0
        ),

      thermalCorrectionFactor:
        second?.thermalCorrectionFactor ??
        first?.thermalCorrectionFactor ??
        1,

      assignedPowerKW:
        (
          (first?.assignedPowerKW || 0) +
          (second?.assignedPowerKW || 0)
        ) / 2,

      effectivePowerKW:
        absorbedEnergyKWh *
        ACS_CONSTANTS.MINUTES_PER_HOUR /
        totalIntervalMinutes,

      absorbedEnergyKWh,

      effectiveMinutes,

      initialExchangerDiagnostic:
        first?.initialExchangerDiagnostic ??
        second?.initialExchangerDiagnostic ??
        null,

      finalExchangerDiagnostic:
        second?.finalExchangerDiagnostic ??
        first?.finalExchangerDiagnostic ??
        null,

      finalTankState:
        second?.finalTankState ??
        first?.finalTankState ??
        null
    };
  }

  const requestedEnergyKWh =
    firstGeneration.requestedEnergyKWh +
    secondGeneration.requestedEnergyKWh;

  const absorbedEnergyKWh =
    firstGeneration.absorbedEnergyKWh +
    secondGeneration.absorbedEnergyKWh;

  return {
    generatorRunning:
      firstGeneration.generatorRunning ||
      secondGeneration.generatorRunning,

    generatorPowerKW:
      firstGeneration.generatorPowerKW,

    requestedEnergyKWh,

    absorbedEnergyKWh,

    unusedEnergyKWh:
      Math.max(
        0,
        requestedEnergyKWh -
        absorbedEnergyKWh
      ),

    initialExchangerDiagnostics:
      firstGeneration.initialExchangerDiagnostics,

    finalExchangerDiagnostics:
      secondGeneration.finalExchangerDiagnostics,

    tankResults
  };
}

/**
 * Resuelve la hidráulica de un subintervalo sin modificar los depósitos
 * definitivos.
 *
 * La demanda del minuto se escala con la duración del subintervalo. La
 * recirculación ya queda escalada por intervalMinutes dentro del estado
 * hidráulico.
 */
function resolveHydraulicSubintervalIteratively(
  params
) {
  const {
    config,
    tanks,
    minuteIndex,
    intervalMinutes,

    tolerance =
      ACS_CONSTANTS
        .DEFAULT_CONVERGENCE_TOLERANCE,

    maxIterations =
      ACS_CONSTANTS
        .DEFAULT_MAX_ITERATIONS,

    relaxationFactor = 0.5
  } = params;

  requirePositiveNumber(
    intervalMinutes,
    "intervalMinutes"
  );

  const minuteDemand =
    getMinuteDemand(
      config.hourlyDemandL,
      minuteIndex,
      config.intrahourDemandWeights
    );

  const equivalentDemandVolumeL =
    minuteDemand.equivalentDemandVolumeL *
    intervalMinutes;

  const initialTankStates =
    getTankStates(tanks);

  const initialOutletTemperatureC =
    getSystemOutletTemperatureC(
      config,
      tanks
    );

  let assumedOutletTemperatureC =
    initialOutletTemperatureC;

  let converged = false;
  let iterations = 0;
  let finalProvisionalTanks = null;
  let finalHydraulicState = null;
  let finalHydraulicResult = null;

  for (
    let iteration = 1;
    iteration <= maxIterations;
    iteration += 1
  ) {
    iterations = iteration;

    const provisionalTanks =
      cloneTanks(tanks);

    const hydraulicState =
      new ACSMinuteHydraulicState({
        minuteIndex,

        hourlyDemandVolumeL:
          minuteDemand.hourlyDemandVolumeL,

        intrahourWeight:
          minuteDemand.intrahourWeight,

        intrahourDemandProfileType:
          config.intrahourDemandProfileType,

        equivalentDemandVolumeL,

        hotWaterTemperatureC:
          assumedOutletTemperatureC,

        storageTemperatureC:
          config.storageTemperatureC,

        useTemperatureC:
          config.useTemperatureC,

        networkTemperatureC:
          config.networkTemperatureC,

        recirculationFlowLPerMinute:
          config.recirculationFlowLPerMinute,

        intervalMinutes
      });

    const hydraulicResult =
      resolveHydraulicPass({
        config,
        tanks: provisionalTanks,
        hydraulicState
      });

    const calculatedOutletTemperatureC =
      hydraulicResult
        .finalOutletTemperatureC;

    finalProvisionalTanks =
      provisionalTanks;

    finalHydraulicState =
      hydraulicState;

    finalHydraulicResult =
      hydraulicResult;

    if (
      hasConverged(
        assumedOutletTemperatureC,
        calculatedOutletTemperatureC,
        tolerance
      )
    ) {
      assumedOutletTemperatureC =
        calculatedOutletTemperatureC;

      converged = true;
      break;
    }

    assumedOutletTemperatureC =
      relaxTemperature(
        assumedOutletTemperatureC,
        calculatedOutletTemperatureC,
        relaxationFactor
      );
  }

  if (!finalProvisionalTanks) {
    throw new ACSSimulationError(
      "No se ha podido resolver el subintervalo hidráulico."
    );
  }

  return {
    converged,
    iterations,
    intervalMinutes,

    initialOutletTemperatureC,

    finalOutletTemperatureC:
      finalHydraulicResult
        .finalOutletTemperatureC,

    assumedOutletTemperatureC,

    hydraulicState:
      finalHydraulicState.getState(),

    hydraulicResult:
      cloneObject(
        finalHydraulicResult
      ),

    initialTankStates,

    finalTankStates:
      getTankStates(
        finalProvisionalTanks
      ),

    provisionalTanks:
      finalProvisionalTanks
  };
}

/**
 * Integra continuamente el balance energético durante un minuto.
 *
 * En cada subintervalo se evalúan, desde el mismo estado inicial:
 *
 *   dE/dt = Pgenerador - Pconsumo - Ppérdidas
 *
 * La generación y la extracción hidráulica se calculan sobre copias
 * independientes. Después se aplica conjuntamente el incremento neto a
 * cada depósito. Así desaparece el orden artificial "generar y después
 * consumir" o "consumir y después generar".
 *
 * El método numérico es Euler explícito por subintervalos. Con 60
 * subintervalos por minuto, el paso de integración es de un segundo.
 */
function integrateContinuousMinute(
  params
) {
  const {
    config,
    tanks,
    generatorState,
    minuteIndex,

    integrationSubsteps = 60,

    tolerance =
      ACS_CONSTANTS
        .DEFAULT_CONVERGENCE_TOLERANCE,

    maxIterations =
      ACS_CONSTANTS
        .DEFAULT_MAX_ITERATIONS,

    relaxationFactor = 0.5
  } = params;

  requirePositiveNumber(
    integrationSubsteps,
    "integrationSubsteps"
  );

  if (!Number.isInteger(integrationSubsteps)) {
    throw new ACSSimulationError(
      "integrationSubsteps debe ser un número entero."
    );
  }

  const intervalMinutes = 1;
  const subintervalMinutes =
    intervalMinutes /
    integrationSubsteps;

  const initialTankStates =
    getTankStates(tanks);

  const initialStoredEnergyKWh =
    calculateTotalStoredEnergyKWh(
      tanks
    );

  const generatorRunningAtMinuteStart =
    generatorState.running;

  let stoppedDuringMinute = false;
  let stopMinuteOffset = null;

  const generationTankTotals =
    tanks.map(
      tank => ({
        tankId: tank.id,
        exchangerType:
          tank.exchangerType,
        nominalExchangerPowerKW:
          tank.exchangerPowerKW,
        absorbedEnergyKWh: 0,
        effectiveMinutes: 0,
        assignedPowerTimeKWMin: 0,
        maximumAbsorbablePowerKW: 0,
        initialExchangerDiagnostic: null,
        finalExchangerDiagnostic: null,
        finalTankState: null
      })
    );

  let generatedEnergyKWh = 0;
  let requestedGenerationEnergyKWh = 0;
  let hydraulicEnergyExtractedKWh = 0;
  let requestedDemandEnergyKWh = 0;
  let coveredDemandEnergyKWh = 0;
  let uncoveredDemandEnergyKWh = 0;
  let coveredEquivalentVolumeL = 0;
  let uncoveredEquivalentVolumeL = 0;
  let equivalentDemandVolumeL = 0;
  let recirculationLossKWh = 0;

  /*
   * Acumuladores hidráulicos del minuto completo.
   *
   * Cada resolución hidráulica devuelve volúmenes correspondientes a un
   * subintervalo (normalmente 1 segundo). No se puede publicar el valor del
   * último subintervalo como si fuese un caudal L/min: hay que sumar los
   * volúmenes de todos los subpasos del minuto.
   */
  let hotConsumptionVolumeL = 0;
  let coldMixingVolumeL = 0;
  let recirculationVolumeL = 0;
  let tankRecirculationVolumeL = 0;
  let bypassRecirculationVolumeL = 0;
  let totalVolumeThroughTanksL = 0;
  let networkReplacementVolumeL = 0;

  let allConverged = true;
  let maximumIterationsUsed = 0;
  let lastHydraulicResolution = null;
  let firstGenerationDiagnostics = null;
  let finalGenerationDiagnostics = null;

  /*
   * Cronología instantánea de potencia dentro del minuto.
   * Cada elemento representa un subintervalo continuo con la potencia
   * realmente absorbida por cada intercambiador y por el generador.
   */
  const powerTimeline = [];

  for (
    let substep = 0;
    substep < integrationSubsteps;
    substep += 1
  ) {
    const substepInitialEnergies =
      tanks.map(
        tank => tank.energyKWh
      );

    /*
     * Rama hidráulica: calcula consumo y pérdidas desde el estado inicial
     * del subintervalo, pero todavía no modifica el estado definitivo.
     */
    const hydraulicResolution =
      resolveHydraulicSubintervalIteratively({
        config,
        tanks,
        minuteIndex,
        intervalMinutes:
          subintervalMinutes,
        tolerance,
        maxIterations,
        relaxationFactor
      });

    /*
     * Rama de generación: se evalúa desde exactamente el mismo estado
     * inicial mediante una copia independiente.
     */
    const hydraulicExtractedEnergyKWhByTank =
      tanks.map(
        (tank, tankIndex) =>
          Math.max(
            0,
            substepInitialEnergies[tankIndex] -
              hydraulicResolution
                .provisionalTanks[tankIndex]
                .energyKWh
          )
      );

    const generationTanks =
      cloneTanks(tanks);

    const generation =
      applyGeneratorForMinute({
        config,
        tanks: generationTanks,
        generatorState,
        intervalMinutes:
          subintervalMinutes,
        hydraulicExtractedEnergyKWhByTank
      });

    if (!firstGenerationDiagnostics) {
      firstGenerationDiagnostics =
        generation
          .initialExchangerDiagnostics;
    }

    finalGenerationDiagnostics =
      generation
        .finalExchangerDiagnostics;

    /*
     * La energía absorbida durante el subintervalo puede corresponder a
     * menos tiempo que la duración completa del paso cuando un depósito
     * alcanza Tset. `effectivePowerKW` es entonces una potencia media y no
     * debe utilizarse como potencia instantánea.
     *
     * Cada intercambiador trabaja a la potencia que se le asignó al inicio
     * del paso y se desconecta exactamente al agotarse su `effectiveMinutes`.
     * Se generan aquí los tramos ON/OFF reales que consumirán la gráfica y
     * la tabla de operación.
     */
    const instantaneousTankStates =
      generation.tankResults.map(
        tankResult => ({
          powerKW:
            Number.isFinite(
              tankResult?.assignedPowerKW
            )
              ? Math.max(
                  0,
                  tankResult.assignedPowerKW
                )
              : 0,

          runningMinutes:
            Number.isFinite(
              tankResult?.effectiveMinutes
            )
              ? Math.min(
                  subintervalMinutes,
                  Math.max(
                    0,
                    tankResult.effectiveMinutes
                  )
                )
              : 0
        })
      );

    const localBoundaries = [
      0,
      subintervalMinutes,
      ...instantaneousTankStates.map(
        state =>
          state.runningMinutes
      )
    ]
      .filter(
        value =>
          Number.isFinite(value) &&
          value >= 0 &&
          value <= subintervalMinutes
      )
      .sort(
        (a, b) => a - b
      )
      .filter(
        (value, index, values) =>
          index === 0 ||
          Math.abs(
            value - values[index - 1]
          ) > 1e-12
      );

    const appendPowerSegment = (
      startMinute,
      endMinute,
      tankPowersKW
    ) => {
      if (
        endMinute - startMinute <=
        1e-12
      ) {
        return;
      }

      const totalPowerKW =
        tankPowersKW.reduce(
          (sum, value) =>
            sum + value,
          0
        );

      const previousSegment =
        powerTimeline[
          powerTimeline.length - 1
        ];

      const sameAsPrevious =
        previousSegment &&
        Math.abs(
          previousSegment.totalPowerKW -
          totalPowerKW
        ) <= 1e-9 &&
        previousSegment.tankPowersKW.length ===
          tankPowersKW.length &&
        previousSegment.tankPowersKW.every(
          (value, index) =>
            Math.abs(
              value -
              tankPowersKW[index]
            ) <= 1e-9
        ) &&
        Math.abs(
          previousSegment.endMinute -
          startMinute
        ) <= 1e-9;

      if (sameAsPrevious) {
        previousSegment.endMinute =
          endMinute;
      } else {
        powerTimeline.push({
          startMinute,
          endMinute,
          totalPowerKW,
          tankPowersKW
        });
      }
    };

    for (
      let boundaryIndex = 0;
      boundaryIndex <
        localBoundaries.length - 1;
      boundaryIndex += 1
    ) {
      const localStart =
        localBoundaries[boundaryIndex];

      const localEnd =
        localBoundaries[boundaryIndex + 1];

      const tankPowersKW =
        instantaneousTankStates.map(
          state =>
            localStart <
            state.runningMinutes - 1e-12
              ? state.powerKW
              : 0
        );

      appendPowerSegment(
        substep * subintervalMinutes +
          localStart,
        substep * subintervalMinutes +
          localEnd,
        tankPowersKW
      );
    }

    tanks.forEach(
      (tank, tankIndex) => {
        const hydraulicFinalEnergyKWh =
          hydraulicResolution
            .provisionalTanks[tankIndex]
            .energyKWh;

        const generationFinalEnergyKWh =
          generationTanks[tankIndex]
            .energyKWh;

        const extractedEnergyKWh =
          Math.max(
            0,
            substepInitialEnergies[tankIndex] -
              hydraulicFinalEnergyKWh
          );

        const tankGeneration =
          generation.tankResults[tankIndex];

        /**
         * La energía generada debe tomarse del resultado explícito del
         * intercambiador. En D2 modulante, la copia de generación se descarga
         * virtualmente antes de aplicar potencia; por ello no puede deducirse
         * comparando únicamente su energía final con el estado inicial.
         */
        const absorbedEnergyKWh =
          Math.max(
            0,
            tankGeneration
              ?.absorbedEnergyKWh || 0
          );

        /*
         * Aplicación simultánea del incremento integrado:
         *
         * E(t + dt) = E(t) + Egen(dt) - Econsumo(dt) - Epérdidas(dt)
         */
        tank.energyKWh =
          substepInitialEnergies[tankIndex] +
          absorbedEnergyKWh -
          extractedEnergyKWh;

        tank.normalizeState();

        const total =
          generationTankTotals[tankIndex];

        total.absorbedEnergyKWh +=
          absorbedEnergyKWh;

        total.effectiveMinutes +=
          tankGeneration?.effectiveMinutes || 0;

        total.assignedPowerTimeKWMin +=
          (tankGeneration?.assignedPowerKW || 0) *
          subintervalMinutes;

        total.maximumAbsorbablePowerKW =
          Math.max(
            total.maximumAbsorbablePowerKW,
            tankGeneration
              ?.maximumAbsorbablePowerKW || 0
          );

        total.initialExchangerDiagnostic ??=
          tankGeneration
            ?.initialExchangerDiagnostic || null;

        total.finalExchangerDiagnostic =
          tankGeneration
            ?.finalExchangerDiagnostic || null;

        total.finalTankState =
          tank.getState();

        hydraulicEnergyExtractedKWh +=
          extractedEnergyKWh;
      }
    );

    /*
     * El control todo/nada también se resuelve dentro del minuto.
     * Cuando el balance integrado deja todos los depósitos al 100 %,
     * el generador se detiene en ese instante y permanece parado en los
     * subintervalos restantes.
     */
    const stopByMinimumPower =
      generatorState.running &&
      generation.minimumPowerStopRequired === true;

    const stopByFullTanks =
      generatorState.running &&
      generationTanks.every(
        tank =>
          tank.isFull ||
          tank.loadPercent >= 99.999
      );

    if (
      stopByMinimumPower ||
      stopByFullTanks
    ) {
      generatorState.running = false;
      generatorState.stopCount += 1;

      if (stopByMinimumPower) {
        generatorState.minimumPowerForcedStopCount += 1;
      }

      stopMinuteOffset =
        (substep + 1) *
        subintervalMinutes;

      generatorState.lastStopMinute =
        minuteIndex +
        stopMinuteOffset;

      generatorState.currentPowerKW = 0;
      generatorState.belowMinimumPowerMinutes = 0;

      stoppedDuringMinute = true;
    }

    generatedEnergyKWh +=
      generation.absorbedEnergyKWh;

    requestedGenerationEnergyKWh +=
      generation.requestedEnergyKWh;

    const coverage =
      hydraulicResolution
        .hydraulicState
        .demandCoverage;

    requestedDemandEnergyKWh +=
      coverage.requestedEnergyKWh;

    coveredDemandEnergyKWh +=
      coverage.coveredEnergyKWh;

    uncoveredDemandEnergyKWh +=
      coverage.uncoveredEnergyKWh;

    coveredEquivalentVolumeL +=
      coverage.coveredEquivalentVolumeL;

    uncoveredEquivalentVolumeL +=
      coverage.uncoveredEquivalentVolumeL;

    equivalentDemandVolumeL +=
      hydraulicResolution
        .hydraulicState
        .equivalentDemandVolumeL;

    recirculationLossKWh +=
      hydraulicResolution
        .hydraulicState
        .recirculationLossKWh;

    hotConsumptionVolumeL +=
      hydraulicResolution
        .hydraulicState
        .hotConsumptionVolumeL || 0;

    coldMixingVolumeL +=
      hydraulicResolution
        .hydraulicState
        .coldMixingVolumeL || 0;

    recirculationVolumeL +=
      hydraulicResolution
        .hydraulicState
        .recirculationVolumeL || 0;

    tankRecirculationVolumeL +=
      hydraulicResolution
        .hydraulicState
        .tankRecirculationVolumeL || 0;

    bypassRecirculationVolumeL +=
      hydraulicResolution
        .hydraulicState
        .bypassRecirculationVolumeL || 0;

    totalVolumeThroughTanksL +=
      hydraulicResolution
        .hydraulicState
        .totalVolumeThroughTanksL || 0;

    networkReplacementVolumeL +=
      hydraulicResolution
        .hydraulicState
        .networkReplacementVolumeL || 0;

    allConverged =
      allConverged &&
      hydraulicResolution.converged;

    maximumIterationsUsed =
      Math.max(
        maximumIterationsUsed,
        hydraulicResolution.iterations
      );

    lastHydraulicResolution =
      hydraulicResolution;
  }

  const finalStoredEnergyKWh =
    calculateTotalStoredEnergyKWh(
      tanks
    );

  const generation = {
    /*
     * Compatibilidad: generatorRunning indica que hubo funcionamiento
     * durante el minuto, aunque la parada se produjera antes de terminar.
     */
    generatorRunning:
      generatedEnergyKWh > 0,

    generatorDemandActive:
      generatorRunningAtMinuteStart ||
      generatorState.running,

    generatorRunningAtStart:
      generatorRunningAtMinuteStart,

    generatorRunningAtEnd:
      generatorState.running,

    stoppedDuringMinute,

    stopMinuteOffset,

    nominalGeneratorPowerKW:
      config.generatorPowerKW,

    generatorPowerKW:
      generatedEnergyKWh *
      ACS_CONSTANTS.MINUTES_PER_HOUR /
      intervalMinutes,

    effectivePowerKW:
      generatedEnergyKWh *
      ACS_CONSTANTS.MINUTES_PER_HOUR /
      intervalMinutes,

    /*
     * El generador entrega exactamente la energía absorbida.
     */
    requestedEnergyKWh:
      generatedEnergyKWh,

    absorbedEnergyKWh:
      generatedEnergyKWh,

    unusedEnergyKWh: 0,

    powerTimeline,

    initialExchangerDiagnostics:
      firstGenerationDiagnostics ||
      tanks.map(
        tank =>
          getTankExchangerDiagnostic(
            tank
          )
      ),

    finalExchangerDiagnostics:
      finalGenerationDiagnostics ||
      tanks.map(
        tank =>
          getTankExchangerDiagnostic(
            tank
          )
      ),

    tankResults:
      generationTankTotals.map(
        total => ({
          tankId:
            total.tankId,

          exchangerType:
            total.exchangerType,

          nominalExchangerPowerKW:
            total.nominalExchangerPowerKW,

          availableExchangerPowerKW:
            total
              .initialExchangerDiagnostic
              ?.effectiveExchangerPowerKW ?? 0,

          maximumAbsorbablePowerKW:
            total.maximumAbsorbablePowerKW,

          thermalCorrectionFactor:
            total
              .finalExchangerDiagnostic
              ?.thermalCorrectionFactor ?? 1,

          assignedPowerKW:
            total.assignedPowerTimeKWMin /
            intervalMinutes,

          effectivePowerKW:
            total.absorbedEnergyKWh *
            ACS_CONSTANTS.MINUTES_PER_HOUR /
            intervalMinutes,

          absorbedEnergyKWh:
            total.absorbedEnergyKWh,

          effectiveMinutes:
            total.effectiveMinutes,

          initialExchangerDiagnostic:
            total.initialExchangerDiagnostic,

          finalExchangerDiagnostic:
            total.finalExchangerDiagnostic,

          finalTankState:
            total.finalTankState
        })
      )
  };

  const demandCoverage = {
    requestedEnergyKWh:
      requestedDemandEnergyKWh,

    coveredEnergyKWh:
      coveredDemandEnergyKWh,

    uncoveredEnergyKWh:
      uncoveredDemandEnergyKWh,

    coveredEquivalentVolumeL,
    uncoveredEquivalentVolumeL,

    coveragePercent:
      calculateCoveragePercent(
        requestedDemandEnergyKWh,
        coveredDemandEnergyKWh
      )
  };

  const hydraulicState = {
    ...lastHydraulicResolution
      .hydraulicState,

    intervalMinutes,
    equivalentDemandVolumeL,

    /*
     * Volúmenes integrados durante el minuto completo. Como el intervalo
     * público dura exactamente un minuto, estos valores numéricos equivalen
     * también a los caudales medios expresados en L/min.
     */
    hotConsumptionVolumeL,
    coldMixingVolumeL,
    recirculationVolumeL,
    tankRecirculationVolumeL,
    bypassRecirculationVolumeL,
    totalVolumeThroughTanksL,
    networkReplacementVolumeL,

    recirculationLossKWh,
    demandCoverage
  };

  const iterativeResolution = {
    converged:
      allConverged,

    iterations:
      maximumIterationsUsed,

    integrationMethod:
      "continuous-explicit-euler",

    integrationSubsteps,

    integrationStepSeconds:
      subintervalMinutes * 60,

    initialOutletTemperatureC:
      initialTankStates[
        initialTankStates.length - 1
      ].outletTemperatureC,

    finalOutletTemperatureC:
      getSystemOutletTemperatureC(
        config,
        tanks
      ),

    assumedOutletTemperatureC:
      lastHydraulicResolution
        .assumedOutletTemperatureC,

    hydraulicState,

    hydraulicResult:
      lastHydraulicResolution
        .hydraulicResult,

    initialTankStates,

    finalTankStates:
      getTankStates(tanks)
  };

  return {
    intervalMinutes,
    subintervalMinutes,
    integrationSubsteps,

    initialTankStates,
    initialStoredEnergyKWh,
    finalStoredEnergyKWh,

    hydraulicEnergyExtractedKWh,
    recirculationLossKWh,

    demandCoverage,
    generation,
    iterativeResolution
  };
}

/**
 * Resuelve un minuto completo mediante integración continua del balance
 * energético. Se conservan sin cambios el control del generador, el modelo
 * hidráulico, los intercambiadores, la demanda, la recirculación y la forma
 * de los resultados públicos.
 */
function resolveSimulationMinute(
  params
) {
  const {
    config,
    tanks,
    generatorState,
    minuteIndex,

    integrationSubsteps = 60,

    tolerance =
      ACS_CONSTANTS
        .DEFAULT_CONVERGENCE_TOLERANCE,

    maxIterations =
      ACS_CONSTANTS
        .DEFAULT_MAX_ITERATIONS,

    relaxationFactor = 0.5
  } = params;

  if (
    !(generatorState instanceof
      ACSGeneratorState)
  ) {
    throw new ACSSimulationError(
      "generatorState debe ser una instancia de ACSGeneratorState."
    );
  }

  const intervalMinutes = 1;

  const initialTankStates =
    getTankStates(tanks);

  const initialStoredEnergyKWh =
    calculateTotalStoredEnergyKWh(
      tanks
    );

  const generatorControl =
    updateGeneratorControlAtMinuteStart({
      config,
      tanks,
      generatorState,
      minuteIndex
    });

  const continuousResolution =
    integrateContinuousMinute({
      config,
      tanks,
      generatorState,
      minuteIndex,
      integrationSubsteps,
      tolerance,
      maxIterations,
      relaxationFactor
    });

  const {
    iterativeResolution,
    generation,
    demandCoverage,
    hydraulicEnergyExtractedKWh,
    recirculationLossKWh
  } = continuousResolution;

  if (generation.stoppedDuringMinute) {
    generatorControl.stopped = true;
    generatorControl.running = false;
    generatorControl.reason =
      "Parada al alcanzar el 100 % durante el minuto.";
    generatorControl.stopMinuteOffset =
      generation.stopMinuteOffset;
  }

  generatorControl.runningAtEnd =
    generation.generatorRunningAtEnd;

  const generatorEffectiveRunningMinutes =
    Array.isArray(
      generation.powerTimeline
    )
      ? generation.powerTimeline.reduce(
          (total, segment) =>
            total +
            (
              segment.totalPowerKW > 1e-9
                ? Math.max(
                    0,
                    segment.endMinute -
                    segment.startMinute
                  )
                : 0
            ),
          0
        )
      : 0;

  generation.effectiveRunningMinutes =
    generatorEffectiveRunningMinutes;

  const finalStoredEnergyKWh =
    calculateTotalStoredEnergyKWh(
      tanks
    );

  const sanitary =
    calculateSanitaryStatus({
      config,
      tanks,
      intervalMinutes
    });

  const storedEnergyVariationKWh =
    finalStoredEnergyKWh -
    initialStoredEnergyKWh;

  const minuteBalanceResidualKWh =
    initialStoredEnergyKWh +
    generation.absorbedEnergyKWh -
    hydraulicEnergyExtractedKWh -
    finalStoredEnergyKWh;

  return {
    minuteIndex,

    hourIndex:
      Math.floor(
        minuteIndex /
        ACS_CONSTANTS.MINUTES_PER_HOUR
      ),

    minuteWithinHour:
      minuteIndex %
      ACS_CONSTANTS.MINUTES_PER_HOUR,

    isStabilizationPeriod:
      minuteIndex <
      config.stabilizationMinutes,

    isAnalysisPeriod:
      minuteIndex >=
      config.stabilizationMinutes,

    initialTankStates,

    generatorControl,

    iterativeResolution,

    generation,

    exchangers: {
      beforeGeneration:
        generation
          .initialExchangerDiagnostics,

      afterGeneration:
        generation
          .finalExchangerDiagnostics
    },

    sanitary,

    energies: {
      initialStoredEnergyKWh,

      /*
       * Campo conservado por compatibilidad. En el cálculo continuo no
       * existe un estado intermedio "después de hidráulica"; se informa el
       * estado final integrado del minuto.
       */
      energyAfterHydraulicsKWh:
        finalStoredEnergyKWh,

      finalStoredEnergyKWh,

      storedEnergyVariationKWh,

      hydraulicEnergyExtractedKWh,

      generatedEnergyKWh:
        generation
          .absorbedEnergyKWh,

      requestedDemandEnergyKWh:
        demandCoverage
          .requestedEnergyKWh,

      coveredDemandEnergyKWh:
        demandCoverage
          .coveredEnergyKWh,

      uncoveredDemandEnergyKWh:
        demandCoverage
          .uncoveredEnergyKWh,

      recirculationLossKWh,

      minuteBalanceResidualKWh
    },

    comfort: {
      equivalentDemandVolumeL:
        iterativeResolution
          .hydraulicState
          .equivalentDemandVolumeL,

      coveredEquivalentVolumeL:
        demandCoverage
          .coveredEquivalentVolumeL,

      uncoveredEquivalentVolumeL:
        demandCoverage
          .uncoveredEquivalentVolumeL,

      coveragePercent:
        demandCoverage
          .coveragePercent,

      actualUseTemperatureC:
        iterativeResolution
          .hydraulicState
          .actualUseTemperatureC,

      targetTemperatureReached:
        iterativeResolution
          .hydraulicState
          .targetTemperatureReached
    },

    finalTankStates:
      getTankStates(tanks),

    generatorState:
      generatorState.getState()
  };
}

/**
 * Ejecuta una secuencia reducida de minutos.
 */
function simulateMinutes(
  inputConfig,
  numberOfMinutes
) {
  requirePositiveNumber(
    numberOfMinutes,
    "numberOfMinutes"
  );

  const config =
    normalizeSimulationConfig(
      inputConfig
    );

  if (
    numberOfMinutes >
    config.simulationMinutes
  ) {
    throw new ACSSimulationError(
      "numberOfMinutes no puede superar la duración total de la simulación.",
      {
        numberOfMinutes,
        maximum:
          config.simulationMinutes
      }
    );
  }

  const tanks =
    createSimulationTanks(
      config
    );

  const generatorState =
    new ACSGeneratorState();

  const minuteResults = [];

  for (
    let minuteIndex = 0;
    minuteIndex < numberOfMinutes;
    minuteIndex += 1
  ) {
    minuteResults.push(
      resolveSimulationMinute({
        config,
        tanks,
        generatorState,
        minuteIndex
      })
    );
  }

  return {
    config,
    tanks,
    generatorState,
    minuteResults
  };
}

/**
 * ============================================================
 * ACTUALIZACIÓN DE EXPORTACIONES
 * ============================================================
 */

const ACSBlock4 = {
  getOutletTank,
  getSystemOutletTemperatureC,

  getTankExchangerDiagnostic,

  ACSGeneratorState,

  updateGeneratorControlAtMinuteStart,
  applyGeneratorForMinute,

  hasConverged,
  relaxTemperature,

  resolveMinuteIteratively,
  resolveHydraulicSubintervalIteratively,
  integrateContinuousMinute,

  calculateSanitaryStatus,
  combinePartialGenerationResults,

  resolveSimulationMinute,
  simulateMinutes
};

/**
 * Node.js
 */
if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = {
    ...module.exports,
    ...ACSBlock4
  };
}

/**
 * Navegador
 */
if (typeof window !== "undefined") {
  window.ACSBlock4 =
    ACSBlock4;

  window.ACS = {
    ...(window.ACS || {}),
    ...(window.ACSBlock1 || {}),
    ...(window.ACSBlock2 || {}),
    ...(window.ACSBlock3 || {}),
    ...ACSBlock4
  };
}

/**
 * ============================================================
 * BLOQUE 5
 * Simulación completa de 48 horas y agregación de resultados
 * ============================================================
 */

/**
 * Devuelve el mínimo de una colección numérica.
 *
 * @param {number[]} values
 * @param {number|null} fallback
 * @returns {number|null}
 */
function minimumOrFallback(
  values,
  fallback = null
) {
  if (!Array.isArray(values)) {
    throw new ACSSimulationError(
      "values debe ser un array."
    );
  }

  const finiteValues =
    values.filter(isFiniteNumber);

  if (finiteValues.length === 0) {
    return fallback;
  }

  return Math.min(...finiteValues);
}

/**
 * Devuelve el máximo de una colección numérica.
 *
 * @param {number[]} values
 * @param {number|null} fallback
 * @returns {number|null}
 */
function maximumOrFallback(
  values,
  fallback = null
) {
  if (!Array.isArray(values)) {
    throw new ACSSimulationError(
      "values debe ser un array."
    );
  }

  const finiteValues =
    values.filter(isFiniteNumber);

  if (finiteValues.length === 0) {
    return fallback;
  }

  return Math.max(...finiteValues);
}

/**
 * Suma una colección numérica.
 *
 * @param {number[]} values
 * @returns {number}
 */
function sumNumbers(values) {
  if (!Array.isArray(values)) {
    throw new ACSSimulationError(
      "values debe ser un array."
    );
  }

  return values.reduce(
    (total, value, index) => {
      requireFiniteNumber(
        value,
        `values[${index}]`
      );

      return total + value;
    },
    0
  );
}

/**
 * Devuelve la media de una colección numérica.
 *
 * Los valores no finitos se ignoran para permitir compatibilidad
 * con depósitos de placas, cuyos datos térmicos específicos pueden
 * ser null.
 *
 * @param {number[]} values
 * @param {number|null} fallback
 * @returns {number|null}
 */
function averageOrFallback(
  values,
  fallback = null
) {
  if (!Array.isArray(values)) {
    throw new ACSSimulationError(
      "values debe ser un array."
    );
  }

  const finiteValues =
    values.filter(isFiniteNumber);

  if (finiteValues.length === 0) {
    return fallback;
  }

  return (
    finiteValues.reduce(
      (total, value) =>
        total + value,
      0
    ) /
    finiteValues.length
  );
}

/**
 * Agrupa resultados de minuto por hora.
 *
 * @param {object[]} minuteResults
 * @returns {Map<number, object[]>}
 */
function groupMinuteResultsByHour(
  minuteResults
) {
  if (!Array.isArray(minuteResults)) {
    throw new ACSSimulationError(
      "minuteResults debe ser un array."
    );
  }

  const groups = new Map();

  minuteResults.forEach(
    minuteResult => {
      const hourIndex =
        minuteResult.hourIndex;

      if (!groups.has(hourIndex)) {
        groups.set(hourIndex, []);
      }

      groups
        .get(hourIndex)
        .push(minuteResult);
    }
  );

  return groups;
}

/**
 * Agrega los resultados de un depósito durante una hora.
 *
 * @param {object[]} minuteResults
 * @param {number} tankIndex
 * @returns {object}
 */
function aggregateTankHourlyResult(
  minuteResults,
  tankIndex
) {
  const initialState =
    minuteResults[0]
      .initialTankStates[tankIndex];

  const finalState =
    minuteResults[
      minuteResults.length - 1
    ].finalTankStates[tankIndex];

  const loadValues =
    minuteResults.map(
      result =>
        result
          .finalTankStates[tankIndex]
          .loadPercent
    );

  const averageTemperatureValues =
    minuteResults.map(
      result =>
        result
          .finalTankStates[tankIndex]
          .averageTemperatureC
    );

  const outletTemperatureValues =
    minuteResults.map(
      result =>
        result
          .finalTankStates[tankIndex]
          .outletTemperatureC
    );

  const effectiveExchangerPowerValues =
    minuteResults.map(
      result =>
        result
          .finalTankStates[tankIndex]
          .effectiveExchangerPowerKW
    );

  const thermalCorrectionFactorValues =
    minuteResults.map(
      result =>
        result
          .finalTankStates[tankIndex]
          .thermalCorrectionFactor
    );

  const lowerZoneLoadValues =
    minuteResults.map(
      result =>
        result
          .finalTankStates[tankIndex]
          .lowerZoneLoadPercent
    );

  const lowerZoneTemperatureValues =
    minuteResults.map(
      result =>
        result
          .finalTankStates[tankIndex]
          .lowerZoneTemperatureC
    );

  const assignedPowerValues =
    minuteResults.map(
      result => {
        const tankResult =
          result
            .generation
            .tankResults[tankIndex];

        return tankResult
          ? tankResult.assignedPowerKW
          : 0;
      }
    );

  const effectiveGeneratedPowerValues =
    minuteResults.map(
      result => {
        const tankResult =
          result
            .generation
            .tankResults[tankIndex];

        return tankResult
          ? tankResult.effectivePowerKW
          : 0;
      }
    );

  const deratingMinutes =
    minuteResults.filter(
      result => {
        const state =
          result
            .finalTankStates[tankIndex];

        return (
          state.exchangerType ===
            ACS_EXCHANGER_TYPES.IMMERSED &&
          isFiniteNumber(
            state.thermalCorrectionFactor
          ) &&
          state.thermalCorrectionFactor <
            (
              ACS_CONSTANTS
                .IMMERSED_EXCHANGER_MAX_CORRECTION_FACTOR -
              ACS_CONSTANTS
                .DEFAULT_CONVERGENCE_TOLERANCE
            )
        );
      }
    ).length;

  const generatedEnergyKWh =
    sumNumbers(
      minuteResults.map(
        result => {
          const tankResult =
            result
              .generation
              .tankResults[tankIndex];

          return tankResult
            ? tankResult.absorbedEnergyKWh
            : 0;
        }
      )
    );

  const effectiveGenerationMinutes =
    sumNumbers(
      minuteResults.map(
        result => {
          const tankResult =
            result
              .generation
              .tankResults[tankIndex];

          return tankResult
            ? tankResult.effectiveMinutes
            : 0;
        }
      )
    );

  return {
    tankId:
      initialState.id,

    initialEnergyKWh:
      initialState.energyKWh,

    finalEnergyKWh:
      finalState.energyKWh,

    storedEnergyVariationKWh:
      finalState.energyKWh -
      initialState.energyKWh,

    generatedEnergyKWh,

    effectiveGenerationMinutes,

    initialLoadPercent:
      initialState.loadPercent,

    finalLoadPercent:
      finalState.loadPercent,

    minimumLoadPercent:
      minimumOrFallback(
        loadValues,
        finalState.loadPercent
      ),

    maximumLoadPercent:
      maximumOrFallback(
        loadValues,
        finalState.loadPercent
      ),

    minimumAverageTemperatureC:
      minimumOrFallback(
        averageTemperatureValues,
        finalState.averageTemperatureC
      ),

    maximumAverageTemperatureC:
      maximumOrFallback(
        averageTemperatureValues,
        finalState.averageTemperatureC
      ),

    minimumOutletTemperatureC:
      minimumOrFallback(
        outletTemperatureValues,
        finalState.outletTemperatureC
      ),

    maximumOutletTemperatureC:
      maximumOrFallback(
        outletTemperatureValues,
        finalState.outletTemperatureC
      ),

    exchanger: {
      type:
        initialState.exchangerType,

      nominalPowerKW:
        initialState.exchangerPowerKW,

      initialEffectivePowerKW:
        initialState
          .effectiveExchangerPowerKW,

      finalEffectivePowerKW:
        finalState
          .effectiveExchangerPowerKW,

      minimumEffectivePowerKW:
        minimumOrFallback(
          effectiveExchangerPowerValues,
          finalState
            .effectiveExchangerPowerKW
        ),

      maximumEffectivePowerKW:
        maximumOrFallback(
          effectiveExchangerPowerValues,
          finalState
            .effectiveExchangerPowerKW
        ),

      averageEffectivePowerKW:
        averageOrFallback(
          effectiveExchangerPowerValues,
          finalState
            .effectiveExchangerPowerKW
        ),

      minimumCorrectionFactor:
        minimumOrFallback(
          thermalCorrectionFactorValues,
          finalState
            .thermalCorrectionFactor
        ),

      maximumCorrectionFactor:
        maximumOrFallback(
          thermalCorrectionFactorValues,
          finalState
            .thermalCorrectionFactor
        ),

      averageCorrectionFactor:
        averageOrFallback(
          thermalCorrectionFactorValues,
          finalState
            .thermalCorrectionFactor
        ),

      finalCorrectionFactor:
        finalState
          .thermalCorrectionFactor,

      averageAssignedPowerKW:
        averageOrFallback(
          assignedPowerValues,
          0
        ),

      maximumAssignedPowerKW:
        maximumOrFallback(
          assignedPowerValues,
          0
        ),

      averageGeneratedPowerKW:
        averageOrFallback(
          effectiveGeneratedPowerValues,
          0
        ),

      maximumGeneratedPowerKW:
        maximumOrFallback(
          effectiveGeneratedPowerValues,
          0
        ),

      deratingMinutes,

      initialLowerZoneLoadPercent:
        initialState
          .lowerZoneLoadPercent,

      finalLowerZoneLoadPercent:
        finalState
          .lowerZoneLoadPercent,

      minimumLowerZoneLoadPercent:
        minimumOrFallback(
          lowerZoneLoadValues,
          finalState
            .lowerZoneLoadPercent
        ),

      maximumLowerZoneLoadPercent:
        maximumOrFallback(
          lowerZoneLoadValues,
          finalState
            .lowerZoneLoadPercent
        ),

      initialLowerZoneTemperatureC:
        initialState
          .lowerZoneTemperatureC,

      finalLowerZoneTemperatureC:
        finalState
          .lowerZoneTemperatureC,

      minimumLowerZoneTemperatureC:
        minimumOrFallback(
          lowerZoneTemperatureValues,
          finalState
            .lowerZoneTemperatureC
        ),

      maximumLowerZoneTemperatureC:
        maximumOrFallback(
          lowerZoneTemperatureValues,
          finalState
            .lowerZoneTemperatureC
        ),

      nominalPrimaryInletTemperatureC:
        initialState
          .nominalPrimaryInletTemperatureC,

      nominalPrimaryOutletTemperatureC:
        initialState
          .nominalPrimaryOutletTemperatureC,

      nominalSecondaryInletTemperatureC:
        initialState
          .nominalSecondaryInletTemperatureC,

      nominalSecondaryOutletTemperatureC:
        initialState
          .nominalSecondaryOutletTemperatureC,

      actualPrimaryInletTemperatureC:
        initialState
          .actualPrimaryInletTemperatureC,

      actualPrimaryOutletTemperatureC:
        initialState
          .actualPrimaryOutletTemperatureC,

      nominalTemperatureDifferenceC:
        initialState
          .nominalTemperatureDifferenceC
    },

    finalAverageTemperatureC:
      finalState.averageTemperatureC,

    finalOutletTemperatureC:
      finalState.outletTemperatureC
  };
}

/**
 * Agrega una hora completa.
 *
 * Cada hora contiene normalmente 60 minutos.
 *
 * @param {object[]} minuteResults
 * @returns {object}
 */
function aggregateHourlyResult(
  minuteResults
) {
  if (
    !Array.isArray(minuteResults) ||
    minuteResults.length === 0
  ) {
    throw new ACSSimulationError(
      "minuteResults debe contener al menos un minuto."
    );
  }

  const orderedMinutes =
    [...minuteResults].sort(
      (a, b) =>
        a.minuteIndex -
        b.minuteIndex
    );

  const firstMinute =
    orderedMinutes[0];

  const lastMinute =
    orderedMinutes[
      orderedMinutes.length - 1
    ];

  const tankCount =
    firstMinute
      .initialTankStates
      .length;

  const tanks = [];

  for (
    let tankIndex = 0;
    tankIndex < tankCount;
    tankIndex += 1
  ) {
    tanks.push(
      aggregateTankHourlyResult(
        orderedMinutes,
        tankIndex
      )
    );
  }

  const generatedEnergyKWh =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .energies
            .generatedEnergyKWh
      )
    );

  const requestedDemandEnergyKWh =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .energies
            .requestedDemandEnergyKWh
      )
    );

  const coveredDemandEnergyKWh =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .energies
            .coveredDemandEnergyKWh
      )
    );

  const uncoveredDemandEnergyKWh =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .energies
            .uncoveredDemandEnergyKWh
      )
    );

  const recirculationLossKWh =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .energies
            .recirculationLossKWh
      )
    );

  const equivalentDemandVolumeL =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .comfort
            .equivalentDemandVolumeL
      )
    );

  const coveredEquivalentVolumeL =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .comfort
            .coveredEquivalentVolumeL
      )
    );

  const uncoveredEquivalentVolumeL =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .comfort
            .uncoveredEquivalentVolumeL
      )
    );

  const generatorRunningMinutes =
    orderedMinutes.filter(
      result =>
        result
          .generation
          .generatorRunning
    ).length;

  /*
   * Potencias horarias explícitas para la UI.
   * La potencia efectiva media de la hora es la energía absorbida
   * dividida por una hora. Se conserva también la potencia nominal
   * configurada y la potencia media solicitada al generador.
   */
  const generatorNominalPowerKW =
    firstMinute
      .generation
      .generatorPowerKW;

  const generatorRequestedEnergyKWh =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .generation
            .requestedEnergyKWh
      )
    );

  const generatorRequestedPowerKW =
    generatorRequestedEnergyKWh;

  const generatorEffectivePowerKW =
    generatedEnergyKWh;

  const generatorOperatingPowerKW =
    generatorRunningMinutes > 0
      ? generatedEnergyKWh *
        ACS_CONSTANTS.MINUTES_PER_HOUR /
        generatorRunningMinutes
      : 0;

  const generatorStarts =
    orderedMinutes.filter(
      result =>
        result
          .generatorControl
          .started
    ).length;

  const generatorStops =
    orderedMinutes.filter(
      result =>
        result
          .generatorControl
          .stopped
    ).length;

  const sanitaryMinutesBelow60C =
    sumNumbers(
      orderedMinutes.map(
        result =>
          result
            .sanitary
            .minutesBelow60C
      )
    );

  const actualUseTemperatures =
    orderedMinutes.map(
      result =>
        result
          .comfort
          .actualUseTemperatureC
    );

  const coveragePercent =
    requestedDemandEnergyKWh > 0
      ? (
          coveredDemandEnergyKWh /
          requestedDemandEnergyKWh *
          100
        )
      : 100;

  const initialStoredEnergyKWh =
    firstMinute
      .energies
      .initialStoredEnergyKWh;

  const finalStoredEnergyKWh =
    lastMinute
      .energies
      .finalStoredEnergyKWh;

  const storedEnergyVariationKWh =
    finalStoredEnergyKWh -
    initialStoredEnergyKWh;

  /**
   * Balance horario:
   *
   * E generada + variación almacenada
   * =
   * demanda cubierta + pérdidas
   *
   * La convención de la memoria utiliza la variación de energía
   * almacenada como:
   *
   * Energía inicial - Energía final
   *
   * para expresar la energía descargada del acumulador.
   */
  const storageDischargeKWh =
    initialStoredEnergyKWh -
    finalStoredEnergyKWh;

  const hourlyBalanceResidualKWh =
    generatedEnergyKWh +
    storageDischargeKWh -
    coveredDemandEnergyKWh -
    recirculationLossKWh;

  const convergenceFailures =
    orderedMinutes.filter(
      result =>
        !result
          .iterativeResolution
          .converged
    ).length;

  const maximumIterationsUsed =
    maximumOrFallback(
      orderedMinutes.map(
        result =>
          result
            .iterativeResolution
            .iterations
      ),
      0
    );

  return {
    hourIndex:
      firstMinute.hourIndex,

    displayedHour:
      firstMinute.hourIndex + 1,

    firstMinuteIndex:
      firstMinute.minuteIndex,

    lastMinuteIndex:
      lastMinute.minuteIndex,

    minuteCount:
      orderedMinutes.length,

    isStabilizationPeriod:
      firstMinute
        .isStabilizationPeriod,

    isAnalysisPeriod:
      firstMinute
        .isAnalysisPeriod,

    energy: {
      initialStoredEnergyKWh,
      finalStoredEnergyKWh,
      storedEnergyVariationKWh,
      storageDischargeKWh,

      generatedEnergyKWh,

      requestedDemandEnergyKWh,
      coveredDemandEnergyKWh,
      uncoveredDemandEnergyKWh,

      recirculationLossKWh,

      hourlyBalanceResidualKWh
    },

    volume: {
      equivalentDemandVolumeL,
      coveredEquivalentVolumeL,
      uncoveredEquivalentVolumeL
    },

    comfort: {
      coveragePercent:
        clamp(
          coveragePercent,
          0,
          100
        ),

      minimumActualUseTemperatureC:
        minimumOrFallback(
          actualUseTemperatures,
          null
        ),

      maximumActualUseTemperatureC:
        maximumOrFallback(
          actualUseTemperatures,
          null
        ),

      minutesBelowTargetTemperature:
        orderedMinutes.filter(
          result =>
            !result
              .comfort
              .targetTemperatureReached
        ).length
    },

    generator: {
      runningMinutes:
        generatorRunningMinutes,

      runningHours:
        generatorRunningMinutes /
        ACS_CONSTANTS
          .MINUTES_PER_HOUR,

      starts:
        generatorStarts,

      stops:
        generatorStops,

      nominalPowerKW:
        generatorNominalPowerKW,

      requestedEnergyKWh:
        generatorRequestedEnergyKWh,

      requestedPowerKW:
        generatorRequestedPowerKW,

      effectivePowerKW:
        generatorEffectivePowerKW,

      absorbedPowerKW:
        generatorEffectivePowerKW,

      operatingPowerKW:
        generatorOperatingPowerKW
    },

    sanitary: {
      enabled:
        firstMinute
          .sanitary
          .enabled,

      evaluatedTankId:
        firstMinute
          .sanitary
          .evaluatedTankId,

      minutesBelow60C:
        sanitaryMinutesBelow60C,

      hoursBelow60C:
        sanitaryMinutesBelow60C /
        ACS_CONSTANTS
          .MINUTES_PER_HOUR
    },

    convergence: {
      failures:
        convergenceFailures,

      maximumIterationsUsed
    },

    tanks
  };
}

/**
 * Genera todos los resultados horarios.
 *
 * @param {object[]} minuteResults
 * @returns {object[]}
 */
function aggregateAllHourlyResults(
  minuteResults
) {
  const grouped =
    groupMinuteResultsByHour(
      minuteResults
    );

  return [...grouped.entries()]
    .sort(
      ([hourA], [hourB]) =>
        hourA - hourB
    )
    .map(
      ([, minutes]) =>
        aggregateHourlyResult(
          minutes
        )
    );
}

/**
 * Suma resultados de varias horas.
 *
 * @param {object[]} hourlyResults
 * @returns {object}
 */
function aggregatePeriodResults(
  hourlyResults
) {
  if (
    !Array.isArray(hourlyResults) ||
    hourlyResults.length === 0
  ) {
    throw new ACSSimulationError(
      "hourlyResults debe contener al menos una hora."
    );
  }

  const firstHour =
    hourlyResults[0];

  const lastHour =
    hourlyResults[
      hourlyResults.length - 1
    ];

  const generatedEnergyKWh =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .energy
            .generatedEnergyKWh
      )
    );

  const requestedDemandEnergyKWh =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .energy
            .requestedDemandEnergyKWh
      )
    );

  const coveredDemandEnergyKWh =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .energy
            .coveredDemandEnergyKWh
      )
    );

  const uncoveredDemandEnergyKWh =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .energy
            .uncoveredDemandEnergyKWh
      )
    );

  const recirculationLossKWh =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .energy
            .recirculationLossKWh
      )
    );

  const equivalentDemandVolumeL =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .volume
            .equivalentDemandVolumeL
      )
    );

  const coveredEquivalentVolumeL =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .volume
            .coveredEquivalentVolumeL
      )
    );

  const uncoveredEquivalentVolumeL =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .volume
            .uncoveredEquivalentVolumeL
      )
    );

  const generatorRunningMinutes =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .generator
            .runningMinutes
      )
    );

  const generatorStarts =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .generator
            .starts
      )
    );

  const generatorStops =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .generator
            .stops
      )
    );

  const sanitaryMinutesBelow60C =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .sanitary
            .minutesBelow60C
      )
    );

  const initialStoredEnergyKWh =
    firstHour
      .energy
      .initialStoredEnergyKWh;

  const finalStoredEnergyKWh =
    lastHour
      .energy
      .finalStoredEnergyKWh;

  const storedEnergyVariationKWh =
    finalStoredEnergyKWh -
    initialStoredEnergyKWh;

  const storageDischargeKWh =
    initialStoredEnergyKWh -
    finalStoredEnergyKWh;

  const balanceResidualKWh =
    generatedEnergyKWh +
    storageDischargeKWh -
    coveredDemandEnergyKWh -
    recirculationLossKWh;

  const coveragePercent =
    requestedDemandEnergyKWh > 0
      ? (
          coveredDemandEnergyKWh /
          requestedDemandEnergyKWh *
          100
        )
      : 100;
      const lossesPercentOfDemand =
  requestedDemandEnergyKWh > 0
    ? (
        recirculationLossKWh /
        requestedDemandEnergyKWh *
        100
      )
    : null;

  const convergenceFailures =
    sumNumbers(
      hourlyResults.map(
        hour =>
          hour
            .convergence
            .failures
      )
    );

  const tankCount =
    firstHour.tanks.length;

  const tanks = [];

  for (
    let tankIndex = 0;
    tankIndex < tankCount;
    tankIndex += 1
  ) {
    const tankHours =
      hourlyResults.map(
        hour =>
          hour.tanks[tankIndex]
      );

    tanks.push({
      tankId:
        tankHours[0].tankId,

      initialEnergyKWh:
        tankHours[0]
          .initialEnergyKWh,

      finalEnergyKWh:
        tankHours[
          tankHours.length - 1
        ].finalEnergyKWh,

      storedEnergyVariationKWh:
        tankHours[
          tankHours.length - 1
        ].finalEnergyKWh -
        tankHours[0]
          .initialEnergyKWh,

      generatedEnergyKWh:
        sumNumbers(
          tankHours.map(
            tank =>
              tank
                .generatedEnergyKWh
          )
        ),

      effectiveGenerationMinutes:
        sumNumbers(
          tankHours.map(
            tank =>
              tank
                .effectiveGenerationMinutes
          )
        ),

      minimumLoadPercent:
        minimumOrFallback(
          tankHours.map(
            tank =>
              tank
                .minimumLoadPercent
          ),
          null
        ),

      maximumLoadPercent:
        maximumOrFallback(
          tankHours.map(
            tank =>
              tank
                .maximumLoadPercent
          ),
          null
        ),

      minimumAverageTemperatureC:
        minimumOrFallback(
          tankHours.map(
            tank =>
              tank
                .minimumAverageTemperatureC
          ),
          null
        ),

      minimumOutletTemperatureC:
        minimumOrFallback(
          tankHours.map(
            tank =>
              tank
                .minimumOutletTemperatureC
          ),
          null
        ),

      exchanger: {
        type:
          tankHours[0]
            .exchanger
            .type,

        nominalPowerKW:
          tankHours[0]
            .exchanger
            .nominalPowerKW,

        initialEffectivePowerKW:
          tankHours[0]
            .exchanger
            .initialEffectivePowerKW,

        finalEffectivePowerKW:
          tankHours[
            tankHours.length - 1
          ]
            .exchanger
            .finalEffectivePowerKW,

        minimumEffectivePowerKW:
          minimumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .minimumEffectivePowerKW
            ),
            null
          ),

        maximumEffectivePowerKW:
          maximumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .maximumEffectivePowerKW
            ),
            null
          ),

        averageEffectivePowerKW:
          averageOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .averageEffectivePowerKW
            ),
            null
          ),

        minimumCorrectionFactor:
          minimumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .minimumCorrectionFactor
            ),
            null
          ),

        maximumCorrectionFactor:
          maximumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .maximumCorrectionFactor
            ),
            null
          ),

        averageCorrectionFactor:
          averageOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .averageCorrectionFactor
            ),
            null
          ),

        finalCorrectionFactor:
          tankHours[
            tankHours.length - 1
          ]
            .exchanger
            .finalCorrectionFactor,

        averageAssignedPowerKW:
          averageOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .averageAssignedPowerKW
            ),
            0
          ),

        maximumAssignedPowerKW:
          maximumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .maximumAssignedPowerKW
            ),
            0
          ),

        averageGeneratedPowerKW:
          averageOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .averageGeneratedPowerKW
            ),
            0
          ),

        maximumGeneratedPowerKW:
          maximumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .maximumGeneratedPowerKW
            ),
            0
          ),

        deratingMinutes:
          sumNumbers(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .deratingMinutes
            )
          ),

        initialLowerZoneLoadPercent:
          tankHours[0]
            .exchanger
            .initialLowerZoneLoadPercent,

        finalLowerZoneLoadPercent:
          tankHours[
            tankHours.length - 1
          ]
            .exchanger
            .finalLowerZoneLoadPercent,

        minimumLowerZoneLoadPercent:
          minimumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .minimumLowerZoneLoadPercent
            ),
            null
          ),

        maximumLowerZoneLoadPercent:
          maximumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .maximumLowerZoneLoadPercent
            ),
            null
          ),

        initialLowerZoneTemperatureC:
          tankHours[0]
            .exchanger
            .initialLowerZoneTemperatureC,

        finalLowerZoneTemperatureC:
          tankHours[
            tankHours.length - 1
          ]
            .exchanger
            .finalLowerZoneTemperatureC,

        minimumLowerZoneTemperatureC:
          minimumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .minimumLowerZoneTemperatureC
            ),
            null
          ),

        maximumLowerZoneTemperatureC:
          maximumOrFallback(
            tankHours.map(
              tank =>
                tank
                  .exchanger
                  .maximumLowerZoneTemperatureC
            ),
            null
          ),

        nominalPrimaryInletTemperatureC:
          tankHours[0]
            .exchanger
            .nominalPrimaryInletTemperatureC,

        nominalPrimaryOutletTemperatureC:
          tankHours[0]
            .exchanger
            .nominalPrimaryOutletTemperatureC,

        nominalSecondaryInletTemperatureC:
          tankHours[0]
            .exchanger
            .nominalSecondaryInletTemperatureC,

        nominalSecondaryOutletTemperatureC:
          tankHours[0]
            .exchanger
            .nominalSecondaryOutletTemperatureC,

        actualPrimaryInletTemperatureC:
          tankHours[0]
            .exchanger
            .actualPrimaryInletTemperatureC,

        actualPrimaryOutletTemperatureC:
          tankHours[0]
            .exchanger
            .actualPrimaryOutletTemperatureC,

        nominalTemperatureDifferenceC:
          tankHours[0]
            .exchanger
            .nominalTemperatureDifferenceC
      },

      finalLoadPercent:
        tankHours[
          tankHours.length - 1
        ].finalLoadPercent,

      finalAverageTemperatureC:
        tankHours[
          tankHours.length - 1
        ].finalAverageTemperatureC,

      finalOutletTemperatureC:
        tankHours[
          tankHours.length - 1
        ].finalOutletTemperatureC
    });
  }

  return {
    firstHourIndex:
      firstHour.hourIndex,

    lastHourIndex:
      lastHour.hourIndex,

    hourCount:
      hourlyResults.length,

    energy: {
  initialStoredEnergyKWh,
  finalStoredEnergyKWh,
  storedEnergyVariationKWh,
  storageDischargeKWh,

  generatedEnergyKWh,

  requestedDemandEnergyKWh,
  coveredDemandEnergyKWh,
  uncoveredDemandEnergyKWh,

  recirculationLossKWh,

  lossesPercentOfDemand,

  balanceResidualKWh
},

    volume: {
      equivalentDemandVolumeL,
      coveredEquivalentVolumeL,
      uncoveredEquivalentVolumeL
    },

    comfort: {
      coveragePercent:
        clamp(
          coveragePercent,
          0,
          100
        ),

      minimumActualUseTemperatureC:
        minimumOrFallback(
          hourlyResults.map(
            hour =>
              hour
                .comfort
                .minimumActualUseTemperatureC
          ),
          null
        ),

      minutesBelowTargetTemperature:
        sumNumbers(
          hourlyResults.map(
            hour =>
              hour
                .comfort
                .minutesBelowTargetTemperature
          )
        )
    },

    generator: {
      runningMinutes:
        generatorRunningMinutes,

      runningHours:
        generatorRunningMinutes /
        ACS_CONSTANTS
          .MINUTES_PER_HOUR,

      starts:
        generatorStarts,

      stops:
        generatorStops
    },

    sanitary: {
      enabled:
        firstHour
          .sanitary
          .enabled,

      evaluatedTankId:
        firstHour
          .sanitary
          .evaluatedTankId,

      minutesBelow60C:
        sanitaryMinutesBelow60C,

      hoursBelow60C:
        sanitaryMinutesBelow60C /
        ACS_CONSTANTS
          .MINUTES_PER_HOUR
    },

    convergence: {
      failures:
        convergenceFailures
    },

    tanks
  };
}


/**
 * Construye una única cronología de funcionamiento todo/nada del generador.
 *
 * El control del motor determina cuándo comienza y termina cada ciclo. La
 * duración energética efectiva del ciclo se obtiene de la energía absorbida
 * y de la potencia nominal fija:
 *
 *   tiempo [min] = energía [kWh] / potencia [kW] * 60
 *
 * Esta cronología es la fuente común para la gráfica y para la tabla horaria.
 */
function buildGeneratorOperatingChronology(
  minuteResults,
  hourlyResults,
  config
) {
  const numberOrZero = value =>
    typeof value === "number" &&
    Number.isFinite(value)
      ? value
      : 0;

  const orderedMinutes =
    Array.isArray(minuteResults)
      ? [...minuteResults].sort(
          (a, b) =>
            a.minuteIndex -
            b.minuteIndex
        )
      : [];

  const nominalPowerKW =
    numberOrZero(
      config?.generatorPowerKW
    );

  const periodStartMinute =
    orderedMinutes.length > 0
      ? orderedMinutes[0].minuteIndex
      : numberOrZero(
          config?.stabilizationMinutes
        );

  const periodMinutes =
    orderedMinutes.length;

  /*
   * Potencia efectiva continua. Los segmentos se generan dentro del motor
   * con la misma resolución temporal utilizada para integrar el balance.
   */
  const powerSegments = [];

  orderedMinutes.forEach(
    (minute, relativeMinuteIndex) => {
      const sourceTimeline =
        Array.isArray(
          minute?.generation
            ?.powerTimeline
        )
          ? minute.generation
              .powerTimeline
          : [];

      sourceTimeline.forEach(
        sourceSegment => {
          const startMinute =
            relativeMinuteIndex +
            numberOrZero(
              sourceSegment.startMinute
            );

          const endMinute =
            relativeMinuteIndex +
            numberOrZero(
              sourceSegment.endMinute
            );

          const totalPowerKW =
            numberOrZero(
              sourceSegment.totalPowerKW
            );

          const tankPowersKW =
            Array.isArray(
              sourceSegment.tankPowersKW
            )
              ? sourceSegment
                  .tankPowersKW
                  .map(numberOrZero)
              : [];

          const previous =
            powerSegments[
              powerSegments.length - 1
            ];

          const sameAsPrevious =
            previous &&
            Math.abs(
              previous.totalPowerKW -
              totalPowerKW
            ) <= 1e-9 &&
            previous.tankPowersKW.length ===
              tankPowersKW.length &&
            previous.tankPowersKW.every(
              (value, index) =>
                Math.abs(
                  value -
                  tankPowersKW[index]
                ) <= 1e-9
            ) &&
            Math.abs(
              previous.endMinute -
              startMinute
            ) <= 1e-9;

          if (sameAsPrevious) {
            previous.endMinute =
              endMinute;
          } else {
            powerSegments.push({
              startMinute,
              endMinute,
              totalPowerKW,
              tankPowersKW
            });
          }
        }
      );
    }
  );

  /*
   * Los ciclos siguen definidos por el control térmico: arrancan cuando se
   * cruza el umbral y terminan al alcanzar el 100 %. La potencia dentro del
   * ciclo puede variar y pasar de un intercambiador a otro.
   */
  const intervals = [];
  let currentInterval = null;

  orderedMinutes.forEach(
    (minute, index) => {
      const control =
        minute.generatorControl || {};

      const relativeMinute =
        minute.minuteIndex -
        periodStartMinute;

      if (
        !currentInterval &&
        (
          control.started === true ||
          control.previousRunning === true ||
          minute?.generation
            ?.generatorDemandActive === true
        )
      ) {
        currentInterval = {
          cycleIndex:
            intervals.length,
          startMinute:
            clamp(
              relativeMinute,
              0,
              periodMinutes
            ),
          absoluteStartMinute:
            minute.minuteIndex,
          carryIn:
            control.started !== true,
          generatedEnergyKWh: 0
        };
      }

      if (currentInterval) {
        currentInterval.generatedEnergyKWh +=
          numberOrZero(
            minute?.generation
              ?.absorbedEnergyKWh
          );
      }

      const isLast =
        index ===
        orderedMinutes.length - 1;

      if (
        currentInterval &&
        (
          control.stopped === true ||
          isLast
        )
      ) {
        const stopOffset =
          control.stopped === true &&
          Number.isFinite(
            minute?.generation
              ?.stopMinuteOffset
          )
            ? minute.generation
                .stopMinuteOffset
            : 1;

        currentInterval.endMinute =
          clamp(
            relativeMinute +
            stopOffset,
            currentInterval.startMinute,
            periodMinutes
          );

        currentInterval.runningMinutes =
          Math.max(
            0,
            currentInterval.endMinute -
            currentInterval.startMinute
          );

        intervals.push(
          currentInterval
        );

        currentInterval = null;
      }
    }
  );

  const hourly =
    Array.from(
      { length: 24 },
      (_value, hourIndex) => {
        const hourStart =
          hourIndex *
          ACS_CONSTANTS.MINUTES_PER_HOUR;

        const hourEnd =
          hourStart +
          ACS_CONSTANTS.MINUTES_PER_HOUR;

        const startsInHour =
          intervals.filter(
            interval =>
              !interval.carryIn &&
              interval.startMinute >=
                hourStart &&
              interval.startMinute <
                hourEnd
          );

        const runningMinutes =
          powerSegments.reduce(
            (total, segment) => {
              if (
                segment.totalPowerKW <=
                1e-9
              ) {
                return total;
              }

              const overlap =
                Math.max(
                  0,
                  Math.min(
                    segment.endMinute,
                    hourEnd
                  ) -
                  Math.max(
                    segment.startMinute,
                    hourStart
                  )
                );

              return total + overlap;
            },
            0
          );

        const firstStartMinuteWithinHour =
          startsInHour.length > 0
            ? startsInHour[0]
                .startMinute -
              hourStart
            : null;

        return {
          hourIndex,
          starts:
            startsInHour.length,
          firstStartMinuteWithinHour,
          runningMinutes,
          runningHours:
            runningMinutes /
            ACS_CONSTANTS
              .MINUTES_PER_HOUR,
          averageRuntimePerStartMinutes:
            startsInHour.length > 0
              ? startsInHour.reduce(
                  (sum, interval) =>
                    sum +
                    interval.runningMinutes,
                  0
                ) /
                startsInHour.length
              : null
        };
      }
    );

  if (Array.isArray(hourlyResults)) {
    hourlyResults
      .slice(0, 24)
      .forEach(
        (hourResult, index) => {
          const operation =
            hourly[index];

          hourResult.generator = {
            ...(hourResult.generator || {}),
            starts:
              operation.starts,
            runningMinutes:
              operation.runningMinutes,
            runningHours:
              operation.runningHours,
            firstStartMinuteWithinHour:
              operation
                .firstStartMinuteWithinHour,
            averageRuntimePerStartMinutes:
              operation
                .averageRuntimePerStartMinutes
          };
        }
      );
  }

  return {
    nominalPowerKW,
    periodStartMinute,
    periodMinutes,
    intervals,
    powerSegments,
    hourly
  };
}

/**
 * Extrae las horas del periodo de estabilización.
 *
 * @param {object[]} hourlyResults
 * @param {object} config
 * @returns {object[]}
 */
function getStabilizationHourlyResults(
  hourlyResults,
  config
) {
  return hourlyResults.filter(
    hour =>
      hour.hourIndex <
      config.stabilizationHours
  );
}

/**
 * Extrae únicamente las últimas 24 horas.
 *
 * @param {object[]} hourlyResults
 * @param {object} config
 * @returns {object[]}
 */
function getAnalysisHourlyResults(
  hourlyResults,
  config
) {
  return hourlyResults.filter(
    hour =>
      hour.hourIndex >=
      config.stabilizationHours
  );
}

/**
 * Extrae únicamente los minutos de las últimas 24 horas.
 *
 * @param {object[]} minuteResults
 * @param {object} config
 * @returns {object[]}
 */
function getAnalysisMinuteResults(
  minuteResults,
  config
) {
  return minuteResults.filter(
    minute =>
      minute.minuteIndex >=
      config.stabilizationMinutes
  );
}

/**
 * Comprueba la continuidad temporal de los resultados.
 *
 * @param {object[]} minuteResults
 * @returns {{
 *   valid: boolean,
 *   expectedMinutes: number,
 *   receivedMinutes: number,
 *   discontinuities: object[]
 * }}
 */
function validateTemporalContinuity(
  minuteResults
) {
  if (!Array.isArray(minuteResults)) {
    throw new ACSSimulationError(
      "minuteResults debe ser un array."
    );
  }

  const discontinuities = [];

  for (
    let index = 0;
    index < minuteResults.length;
    index += 1
  ) {
    const expectedMinuteIndex =
      index;

    const receivedMinuteIndex =
      minuteResults[index]
        .minuteIndex;

    if (
      receivedMinuteIndex !==
      expectedMinuteIndex
    ) {
      discontinuities.push({
        position: index,
        expectedMinuteIndex,
        receivedMinuteIndex
      });
    }
  }

  return {
    valid:
      discontinuities.length === 0,

    expectedMinutes:
      minuteResults.length,

    receivedMinutes:
      minuteResults.length,

    discontinuities
  };
}

/**
 * Ejecuta la simulación completa de 48 horas.
 *
 * Las primeras 24 horas se conservan como periodo de estabilización.
 * Solo las últimas 24 horas forman parte de los resultados finales.
 *
 * @param {object} inputConfig
 * @param {object} [options]
 * @param {boolean} [options.includeMinuteResults=true]
 * @param {number} [options.tolerance]
 * @param {number} [options.maxIterations]
 * @param {number} [options.relaxationFactor=0.5]
 *
 * @returns {object}
 */
function simulateACS(
  inputConfig,
  options = {}
) {
  const config =
    normalizeSimulationConfig(
      inputConfig
    );

  const includeMinuteResults =
    options.includeMinuteResults === undefined
      ? true
      : Boolean(
          options.includeMinuteResults
        );

  const tolerance =
    options.tolerance === undefined
      ? ACS_CONSTANTS
          .DEFAULT_CONVERGENCE_TOLERANCE
      : requireNonNegativeNumber(
          options.tolerance,
          "options.tolerance"
        );

  const maxIterations =
    options.maxIterations === undefined
      ? ACS_CONSTANTS
          .DEFAULT_MAX_ITERATIONS
      : requirePositiveNumber(
          options.maxIterations,
          "options.maxIterations"
        );

  const relaxationFactor =
    options.relaxationFactor === undefined
      ? 0.5
      : requireNumberInRange(
          options.relaxationFactor,
          0,
          1,
          "options.relaxationFactor"
        );

  const tanks =
    createSimulationTanks(
      config
    );

  const generatorState =
    new ACSGeneratorState();

  const minuteResults = [];

  for (
    let minuteIndex = 0;
    minuteIndex <
      config.simulationMinutes;
    minuteIndex += 1
  ) {
    const minuteResult =
      resolveSimulationMinute({
        config,
        tanks,
        generatorState,
        minuteIndex,
        tolerance,
        maxIterations,
        relaxationFactor
      });

    minuteResults.push(
      minuteResult
    );
  }

  const hourlyResults =
    aggregateAllHourlyResults(
      minuteResults
    );

  const stabilizationHourlyResults =
    getStabilizationHourlyResults(
      hourlyResults,
      config
    );

  const analysisHourlyResults =
    getAnalysisHourlyResults(
      hourlyResults,
      config
    );

  const analysisMinuteResults =
    getAnalysisMinuteResults(
      minuteResults,
      config
    );

  const generatorOperation =
    buildGeneratorOperatingChronology(
      analysisMinuteResults,
      analysisHourlyResults,
      config
    );

  const stabilizationTotals =
    aggregatePeriodResults(
      stabilizationHourlyResults
    );

  const analysisTotals =
    aggregatePeriodResults(
      analysisHourlyResults
    );

  const completeTotals =
    aggregatePeriodResults(
      hourlyResults
    );

  const temporalValidation =
    validateTemporalContinuity(
      minuteResults
    );

  return {
    metadata: {
      model:
        "ACS Simulation Engine",

      simulationHours:
        config.simulationHours,

      simulationMinutes:
        config.simulationMinutes,

      stabilizationHours:
        config.stabilizationHours,

      analysisHours:
        config.simulationHours -
        config.stabilizationHours,

      intervalMinutes: 1,

      tankCount:
        config.tankCount
    },

    config:
      cloneObject(config),

    validation: {
      temporal:
        temporalValidation,

      convergence: {
        completePeriodFailures:
          completeTotals
            .convergence
            .failures,

        analysisPeriodFailures:
          analysisTotals
            .convergence
            .failures
      },

      analysisEnergyBalance: {
        residualKWh:
          analysisTotals
            .energy
            .balanceResidualKWh,

        absoluteResidualKWh:
          Math.abs(
            analysisTotals
              .energy
              .balanceResidualKWh
          )
      }
    },

    results: {
      stabilization: {
        hourly:
          stabilizationHourlyResults,

        totals:
          stabilizationTotals
      },

      analysis: {
        hourly:
          analysisHourlyResults,

        totals:
          analysisTotals,

        generatorOperation,

        minute:
          includeMinuteResults
            ? analysisMinuteResults
            : undefined
      },

      completeSimulation: {
        hourly:
          hourlyResults,

        totals:
          completeTotals,

        minute:
          includeMinuteResults
            ? minuteResults
            : undefined
      }
    },

    finalState: {
      tanks:
        getTankStates(tanks),

      generator:
        generatorState.getState()
    }
  };
}

/**
 * Crea un resumen compacto de los resultados finales.
 *
 * @param {object} simulationResult
 * @returns {object}
 */
function createSimulationSummary(
  simulationResult
) {
  if (
    !simulationResult ||
    typeof simulationResult !== "object"
  ) {
    throw new ACSSimulationError(
      "simulationResult es obligatorio."
    );
  }

  const totals =
    simulationResult
      .results
      .analysis
      .totals;

  return {
    periodHours:
      totals.hourCount,

    energy: {
      generatedKWh:
        totals
          .energy
          .generatedEnergyKWh,

      initialStoredKWh:
        totals
          .energy
          .initialStoredEnergyKWh,

      finalStoredKWh:
        totals
          .energy
          .finalStoredEnergyKWh,

      suppliedKWh:
        totals
          .energy
          .coveredDemandEnergyKWh,

      uncoveredKWh:
        totals
          .energy
          .uncoveredDemandEnergyKWh,

      lossesKWh:
  totals
    .energy
    .recirculationLossKWh,

lossesPercentOfDemand:
  totals
    .energy
    .lossesPercentOfDemand,

configuredLossPercent:
  simulationResult.config.lossPercent,

targetLossesKWh:
  simulationResult.config.dailyRecirculationLossTargetKWh,

calculatedRecirculationFlowLPerMinute:
  simulationResult.config.recirculationFlowLPerMinute,

balanceResidualKWh:
  totals
    .energy
    .balanceResidualKWh
    },

    comfort: {
      coveragePercent:
        totals
          .comfort
          .coveragePercent,

      uncoveredEquivalentVolumeL:
        totals
          .volume
          .uncoveredEquivalentVolumeL,

      minimumUseTemperatureC:
        totals
          .comfort
          .minimumActualUseTemperatureC,

      minutesBelowTarget:
        totals
          .comfort
          .minutesBelowTargetTemperature
    },

    generator: {
      runningHours:
        totals
          .generator
          .runningHours,

      starts:
        totals
          .generator
          .starts,

      stops:
        totals
          .generator
          .stops
    },

    sanitary: {
      enabled:
        totals
          .sanitary
          .enabled,

      evaluatedTankId:
        totals
          .sanitary
          .evaluatedTankId,

      hoursBelow60C:
        totals
          .sanitary
          .hoursBelow60C
    },

    exchangers:
      totals.tanks.map(
        tank => ({
          tankId:
            tank.tankId,

          ...cloneObject(
            tank.exchanger
          )
        })
      ),

    convergenceFailures:
      totals
        .convergence
        .failures,

    tanks:
      totals.tanks
  };
}

/**
 * ============================================================
 * ACTUALIZACIÓN DE EXPORTACIONES
 * ============================================================
 */

const ACSBlock5 = {
  minimumOrFallback,
  maximumOrFallback,
  sumNumbers,
  averageOrFallback,

  groupMinuteResultsByHour,

  aggregateTankHourlyResult,
  aggregateHourlyResult,
  aggregateAllHourlyResults,
  aggregatePeriodResults,

  getStabilizationHourlyResults,
  getAnalysisHourlyResults,
  getAnalysisMinuteResults,

  validateTemporalContinuity,

  simulateACS,
  createSimulationSummary
};

/**
 * Node.js
 */
if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = {
    ...module.exports,
    ...ACSBlock5
  };
}

/**
 * Navegador
 */
if (typeof window !== "undefined") {
  window.ACSBlock5 =
    ACSBlock5;

  window.ACS = {
    ...(window.ACS || {}),
    ...(window.ACSBlock1 || {}),
    ...(window.ACSBlock2 || {}),
    ...(window.ACSBlock3 || {}),
    ...(window.ACSBlock4 || {}),
    ...ACSBlock5
  };
}

/**
 * ============================================================
 * BLOQUE 6
 * Validaciones finales, salida para interfaz y API pública
 * ============================================================
 *
 * Este bloque debe pegarse después del Bloque 5.
 *
 * Requiere:
 * - Bloques 1 a 5 cargados previamente.
 * - Demanda de usuario referida a 60 °C.
 * - Conversión interna de demanda a Tuso.
 * - Recirculación con bypass.
 */

/**
 * Tolerancias generales de validación.
 */
const ACS_VALIDATION_DEFAULTS = Object.freeze({
  ENERGY_TOLERANCE_KWH: 1e-6,
  HYDRAULIC_TOLERANCE_L: 1e-6,
  TEMPERATURE_TOLERANCE_C: 1e-6,
  LOAD_TOLERANCE_PERCENT: 1e-6,
  VOLUME_TOLERANCE_L: 1e-6,
  PERCENT_TOLERANCE: 1e-6,
  POWER_TOLERANCE_KW: 1e-6,
  CORRECTION_FACTOR_TOLERANCE: 1e-9,

  EQUIVALENCE_ABSOLUTE_TOLERANCE_KWH: 0.05,
  EQUIVALENCE_PERCENT_TOLERANCE: 1
});

/**
 * Devuelve el valor de una opción o un valor por defecto.
 */
function getValidationOption(
  options,
  name,
  defaultValue
) {
  if (
    !options ||
    options[name] === undefined
  ) {
    return defaultValue;
  }

  return requireNonNegativeNumber(
    options[name],
    `options.${name}`
  );
}

/**
 * Comprueba que un número esté dentro de un intervalo,
 * admitiendo una tolerancia.
 */
function isWithinRangeWithTolerance(
  value,
  minimum,
  maximum,
  tolerance = 0
) {
  requireFiniteNumber(value, "value");
  requireFiniteNumber(minimum, "minimum");
  requireFiniteNumber(maximum, "maximum");
  requireNonNegativeNumber(tolerance, "tolerance");

  return (
    value >= minimum - tolerance &&
    value <= maximum + tolerance
  );
}

/**
 * Comprueba si dos números son aproximadamente iguales.
 */
function approximatelyEqual(
  valueA,
  valueB,
  tolerance
) {
  requireFiniteNumber(valueA, "valueA");
  requireFiniteNumber(valueB, "valueB");
  requireNonNegativeNumber(tolerance, "tolerance");

  return (
    Math.abs(valueA - valueB) <=
    tolerance
  );
}

/**
 * Calcula la diferencia porcentual simétrica entre dos números.
 */
function calculatePercentDifference(
  valueA,
  valueB
) {
  requireFiniteNumber(valueA, "valueA");
  requireFiniteNumber(valueB, "valueB");

  const reference =
    Math.max(
      Math.abs(valueA),
      Math.abs(valueB),
      1e-12
    );

  return (
    Math.abs(valueA - valueB) /
    reference *
    100
  );
}

/**
 * Crea una incidencia normalizada.
 */
function createValidationIssue(
  type,
  details = {}
) {
  return {
    type,
    ...details
  };
}

/**
 * Comprueba la estructura básica de una simulación.
 */
function validateSimulationStructure(
  simulationResult
) {
  const issues = [];

  if (
    !simulationResult ||
    typeof simulationResult !== "object"
  ) {
    return {
      valid: false,
      issues: [
        createValidationIssue(
          "invalid-simulation-result"
        )
      ]
    };
  }

  if (
    !simulationResult.config ||
    typeof simulationResult.config !== "object"
  ) {
    issues.push(
      createValidationIssue(
        "missing-config"
      )
    );
  }

  if (
    !simulationResult.results ||
    typeof simulationResult.results !== "object"
  ) {
    issues.push(
      createValidationIssue(
        "missing-results"
      )
    );
  }

  const completeSimulation =
    simulationResult.results &&
    simulationResult
      .results
      .completeSimulation;

  if (
    !completeSimulation ||
    typeof completeSimulation !== "object"
  ) {
    issues.push(
      createValidationIssue(
        "missing-complete-simulation"
      )
    );
  }

  const analysis =
    simulationResult.results &&
    simulationResult
      .results
      .analysis;

  if (
    !analysis ||
    typeof analysis !== "object"
  ) {
    issues.push(
      createValidationIssue(
        "missing-analysis-results"
      )
    );
  }

  return {
    valid:
      issues.length === 0,

    issues
  };
}

/**
 * Valida el estado físico de un depósito.
 *
 * Comprueba:
 * - energía entre 0 y capacidad máxima;
 * - carga entre 0 y 100 %;
 * - coherencia energía/carga;
 * - coherencia carga/temperatura media;
 * - límites de temperatura de salida.
 */
function validateTankPhysicalState(
  tankState,
  options = {}
) {
  if (
    !tankState ||
    typeof tankState !== "object"
  ) {
    throw new ACSSimulationError(
      "tankState es obligatorio."
    );
  }

  const energyToleranceKWh =
    getValidationOption(
      options,
      "energyToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .ENERGY_TOLERANCE_KWH
    );

  const temperatureToleranceC =
    getValidationOption(
      options,
      "temperatureToleranceC",
      ACS_VALIDATION_DEFAULTS
        .TEMPERATURE_TOLERANCE_C
    );

  const loadTolerancePercent =
    getValidationOption(
      options,
      "loadTolerancePercent",
      ACS_VALIDATION_DEFAULTS
        .LOAD_TOLERANCE_PERCENT
    );

  const issues = [];

  const numericFields = [
    "volumeL",
    "exchangerPowerKW",
    "energyKWh",
    "maximumUsefulEnergyKWh",
    "remainingCapacityKWh",
    "loadPercent",
    "averageTemperatureC",
    "outletTemperatureC"
  ];

  numericFields.forEach(
    field => {
      if (!isFiniteNumber(tankState[field])) {
        issues.push(
          createValidationIssue(
            "invalid-number",
            {
              field,
              value:
                tankState[field]
            }
          )
        );
      }
    }
  );

  if (issues.length > 0) {
    return {
      valid: false,
      tankId:
        tankState.id || null,
      issues
    };
  }

  if (
    !isWithinRangeWithTolerance(
      tankState.energyKWh,
      0,
      tankState.maximumUsefulEnergyKWh,
      energyToleranceKWh
    )
  ) {
    issues.push(
      createValidationIssue(
        "energy-out-of-range",
        {
          value:
            tankState.energyKWh,
          minimum: 0,
          maximum:
            tankState.maximumUsefulEnergyKWh
        }
      )
    );
  }

  if (
    !isWithinRangeWithTolerance(
      tankState.loadPercent,
      0,
      100,
      loadTolerancePercent
    )
  ) {
    issues.push(
      createValidationIssue(
        "load-out-of-range",
        {
          value:
            tankState.loadPercent,
          minimum: 0,
          maximum: 100
        }
      )
    );
  }

  const expectedLoadPercent =
    tankState.maximumUsefulEnergyKWh > 0
      ? (
          tankState.energyKWh /
          tankState.maximumUsefulEnergyKWh *
          100
        )
      : 0;

  if (
    !approximatelyEqual(
      tankState.loadPercent,
      expectedLoadPercent,
      loadTolerancePercent
    )
  ) {
    issues.push(
      createValidationIssue(
        "energy-load-inconsistency",
        {
          loadPercent:
            tankState.loadPercent,
          expectedLoadPercent
        }
      )
    );
  }

  const networkTemperatureC =
    isFiniteNumber(
      tankState.networkTemperatureC
    )
      ? tankState.networkTemperatureC
      : null;

  const storageTemperatureC =
    isFiniteNumber(
      tankState.storageTemperatureC
    )
      ? tankState.storageTemperatureC
      : null;

  /*
   * getState() del Bloque 1 no incluye todavía Tred y Tacum.
   * Cuando no están presentes se infieren mediante los demás datos.
   */
  if (
    networkTemperatureC !== null &&
    storageTemperatureC !== null
  ) {
    const expectedAverageTemperatureC =
      networkTemperatureC +
      (
        storageTemperatureC -
        networkTemperatureC
      ) *
      tankState.loadPercent /
      100;

    if (
      !approximatelyEqual(
        tankState.averageTemperatureC,
        expectedAverageTemperatureC,
        temperatureToleranceC
      )
    ) {
      issues.push(
        createValidationIssue(
          "load-average-temperature-inconsistency",
          {
            averageTemperatureC:
              tankState.averageTemperatureC,
            expectedAverageTemperatureC
          }
        )
      );
    }

    if (
      !isWithinRangeWithTolerance(
        tankState.outletTemperatureC,
        networkTemperatureC,
        storageTemperatureC,
        temperatureToleranceC
      )
    ) {
      issues.push(
        createValidationIssue(
          "outlet-temperature-out-of-range",
          {
            value:
              tankState.outletTemperatureC,
            minimum:
              networkTemperatureC,
            maximum:
              storageTemperatureC
          }
        )
      );
    }
  }

  return {
    valid:
      issues.length === 0,

    tankId:
      tankState.id || null,

    issues
  };
}

/**
 * Valida la coherencia del intercambiador de un depósito.
 *
 * Placas:
 * - factor térmico = 1;
 * - potencia efectiva = potencia nominal.
 *
 * Serpentín:
 * - temperaturas nominales y reales válidas;
 * - ΔT nominal positivo;
 * - factor entre 0 y 1;
 * - potencia efectiva coherente con el factor;
 * - temperatura y carga del tercio inferior dentro de límites.
 */
function validateTankExchangerState(
  tankState,
  options = {}
) {
  if (
    !tankState ||
    typeof tankState !== "object"
  ) {
    throw new ACSSimulationError(
      "tankState es obligatorio."
    );
  }

  const powerToleranceKW =
    getValidationOption(
      options,
      "powerToleranceKW",
      ACS_VALIDATION_DEFAULTS
        .POWER_TOLERANCE_KW
    );

  const temperatureToleranceC =
    getValidationOption(
      options,
      "temperatureToleranceC",
      ACS_VALIDATION_DEFAULTS
        .TEMPERATURE_TOLERANCE_C
    );

  const factorTolerance =
    getValidationOption(
      options,
      "correctionFactorTolerance",
      ACS_VALIDATION_DEFAULTS
        .CORRECTION_FACTOR_TOLERANCE
    );

  const issues = [];

  const exchangerType =
    tankState.exchangerType ||
    ACS_EXCHANGER_TYPES.PLATE;

  if (
    exchangerType !==
      ACS_EXCHANGER_TYPES.PLATE &&
    exchangerType !==
      ACS_EXCHANGER_TYPES.IMMERSED
  ) {
    issues.push(
      createValidationIssue(
        "invalid-exchanger-type",
        {
          exchangerType
        }
      )
    );

    return {
      valid: false,
      tankId:
        tankState.id || null,
      exchangerType,
      issues
    };
  }

  const requiredNumericFields = [
    "exchangerPowerKW",
    "effectiveExchangerPowerKW",
    "thermalCorrectionFactor",
    "lowerZoneLoadPercent",
    "lowerZoneTemperatureC"
  ];

  requiredNumericFields.forEach(
    field => {
      if (
        !isFiniteNumber(
          tankState[field]
        )
      ) {
        issues.push(
          createValidationIssue(
            "invalid-exchanger-number",
            {
              field,
              value:
                tankState[field]
            }
          )
        );
      }
    }
  );

  if (issues.length > 0) {
    return {
      valid: false,
      tankId:
        tankState.id || null,
      exchangerType,
      issues
    };
  }

  if (
    tankState.exchangerPowerKW <
    -powerToleranceKW
  ) {
    issues.push(
      createValidationIssue(
        "negative-nominal-exchanger-power",
        {
          value:
            tankState.exchangerPowerKW
        }
      )
    );
  }

  if (
    tankState.effectiveExchangerPowerKW <
      -powerToleranceKW ||
    tankState.effectiveExchangerPowerKW >
      tankState.exchangerPowerKW +
      powerToleranceKW
  ) {
    issues.push(
      createValidationIssue(
        "effective-exchanger-power-out-of-range",
        {
          value:
            tankState.effectiveExchangerPowerKW,
          minimum: 0,
          maximum:
            tankState.exchangerPowerKW
        }
      )
    );
  }

  if (
    !isWithinRangeWithTolerance(
      tankState.thermalCorrectionFactor,
      0,
      1,
      factorTolerance
    )
  ) {
    issues.push(
      createValidationIssue(
        "thermal-correction-factor-out-of-range",
        {
          value:
            tankState.thermalCorrectionFactor,
          minimum: 0,
          maximum: 1
        }
      )
    );
  }

  const expectedEffectivePowerKW =
    tankState.exchangerPowerKW *
    tankState.thermalCorrectionFactor;

  if (
    !approximatelyEqual(
      tankState.effectiveExchangerPowerKW,
      expectedEffectivePowerKW,
      powerToleranceKW
    )
  ) {
    issues.push(
      createValidationIssue(
        "effective-exchanger-power-inconsistency",
        {
          effectiveExchangerPowerKW:
            tankState
              .effectiveExchangerPowerKW,

          expectedEffectivePowerKW,

          exchangerPowerKW:
            tankState.exchangerPowerKW,

          thermalCorrectionFactor:
            tankState
              .thermalCorrectionFactor
        }
      )
    );
  }

  if (
    !isWithinRangeWithTolerance(
      tankState.lowerZoneLoadPercent,
      0,
      100,
      factorTolerance * 100
    )
  ) {
    issues.push(
      createValidationIssue(
        "lower-zone-load-out-of-range",
        {
          value:
            tankState.lowerZoneLoadPercent,
          minimum: 0,
          maximum: 100
        }
      )
    );
  }

  if (
    exchangerType ===
    ACS_EXCHANGER_TYPES.PLATE
  ) {
    if (
      !approximatelyEqual(
        tankState.thermalCorrectionFactor,
        1,
        factorTolerance
      )
    ) {
      issues.push(
        createValidationIssue(
          "plate-correction-factor-not-one",
          {
            value:
              tankState
                .thermalCorrectionFactor
          }
        )
      );
    }

    if (
      !approximatelyEqual(
        tankState.effectiveExchangerPowerKW,
        tankState.exchangerPowerKW,
        powerToleranceKW
      )
    ) {
      issues.push(
        createValidationIssue(
          "plate-effective-power-mismatch",
          {
            nominalPowerKW:
              tankState.exchangerPowerKW,

            effectivePowerKW:
              tankState
                .effectiveExchangerPowerKW
          }
        )
      );
    }
  }

  if (
    exchangerType ===
    ACS_EXCHANGER_TYPES.IMMERSED
  ) {
    const immersedFields = [
      "nominalPrimaryInletTemperatureC",
      "nominalPrimaryOutletTemperatureC",
      "nominalPrimaryMeanTemperatureC",
      "nominalSecondaryInletTemperatureC",
      "nominalSecondaryOutletTemperatureC",
      "nominalSecondaryMeanTemperatureC",
      "nominalTemperatureDifferenceC",
      "actualPrimaryInletTemperatureC",
      "actualPrimaryOutletTemperatureC",
      "actualPrimaryMeanTemperatureC",
      "actualTemperatureDifferenceC"
    ];

    immersedFields.forEach(
      field => {
        if (
          !isFiniteNumber(
            tankState[field]
          )
        ) {
          issues.push(
            createValidationIssue(
              "invalid-immersed-exchanger-number",
              {
                field,
                value:
                  tankState[field]
              }
            )
          );
        }
      }
    );

    if (
      issues.every(
        issue =>
          issue.type !==
          "invalid-immersed-exchanger-number"
      )
    ) {
      if (
        tankState
          .nominalPrimaryInletTemperatureC <=
        tankState
          .nominalPrimaryOutletTemperatureC
      ) {
        issues.push(
          createValidationIssue(
            "invalid-nominal-primary-temperatures"
          )
        );
      }

      if (
        tankState
          .nominalSecondaryOutletTemperatureC <=
        tankState
          .nominalSecondaryInletTemperatureC
      ) {
        issues.push(
          createValidationIssue(
            "invalid-nominal-secondary-temperatures"
          )
        );
      }

      if (
        tankState
          .actualPrimaryInletTemperatureC <=
        tankState
          .actualPrimaryOutletTemperatureC
      ) {
        issues.push(
          createValidationIssue(
            "invalid-actual-primary-temperatures"
          )
        );
      }

      if (
        tankState
          .nominalTemperatureDifferenceC <=
        temperatureToleranceC
      ) {
        issues.push(
          createValidationIssue(
            "non-positive-nominal-temperature-difference",
            {
              value:
                tankState
                  .nominalTemperatureDifferenceC
            }
          )
        );
      }

      if (
        tankState
          .actualTemperatureDifferenceC <
        -temperatureToleranceC
      ) {
        issues.push(
          createValidationIssue(
            "negative-actual-temperature-difference",
            {
              value:
                tankState
                  .actualTemperatureDifferenceC
            }
          )
        );
      }
    }
  }

  return {
    valid:
      issues.length === 0,

    tankId:
      tankState.id || null,

    exchangerType,

    issues
  };
}

/**
 * Valida todos los depósitos de un minuto.
 */
function validateMinuteTankStates(
  minuteResult,
  options = {}
) {
  if (
    !minuteResult ||
    typeof minuteResult !== "object"
  ) {
    throw new ACSSimulationError(
      "minuteResult es obligatorio."
    );
  }

  if (
    !Array.isArray(
      minuteResult.finalTankStates
    )
  ) {
    return {
      minuteIndex:
        minuteResult.minuteIndex,

      valid: false,

      tanks: [],

      issues: [
        createValidationIssue(
          "missing-final-tank-states"
        )
      ]
    };
  }

  const tanks =
    minuteResult
      .finalTankStates
      .map(
        tankState => {
          const physical =
            validateTankPhysicalState(
              tankState,
              options
            );

          const exchanger =
            validateTankExchangerState(
              tankState,
              options
            );

          return {
            valid:
              physical.valid &&
              exchanger.valid,

            tankId:
              tankState.id || null,

            physical,
            exchanger,

            issues: [
              ...physical.issues,
              ...exchanger.issues
            ]
          };
        }
      );

  return {
    minuteIndex:
      minuteResult.minuteIndex,

    valid:
      tanks.every(
        validation =>
          validation.valid
      ),

    tanks,

    issues: []
  };
}

/**
 * Valida el balance energético interno de un minuto.
 *
 * Einicial + Egenerada - Eextraída - Efinal = 0
 */
function validateMinuteEnergyBalance(
  minuteResult,
  toleranceKWh =
    ACS_VALIDATION_DEFAULTS
      .ENERGY_TOLERANCE_KWH
) {
  if (
    !minuteResult ||
    typeof minuteResult !== "object"
  ) {
    throw new ACSSimulationError(
      "minuteResult es obligatorio."
    );
  }

  requireNonNegativeNumber(
    toleranceKWh,
    "toleranceKWh"
  );

  const energies =
    minuteResult.energies;

  if (
    !energies ||
    typeof energies !== "object"
  ) {
    return {
      minuteIndex:
        minuteResult.minuteIndex,

      valid: false,

      toleranceKWh,

      residualKWh: null,

      absoluteResidualKWh: null,

      issues: [
        createValidationIssue(
          "missing-minute-energies"
        )
      ]
    };
  }

  const requiredFields = [
    "initialStoredEnergyKWh",
    "generatedEnergyKWh",
    "hydraulicEnergyExtractedKWh",
    "finalStoredEnergyKWh"
  ];

  const invalidFields =
    requiredFields.filter(
      field =>
        !isFiniteNumber(
          energies[field]
        )
    );

  if (invalidFields.length > 0) {
    return {
      minuteIndex:
        minuteResult.minuteIndex,

      valid: false,

      toleranceKWh,

      residualKWh: null,

      absoluteResidualKWh: null,

      issues:
        invalidFields.map(
          field =>
            createValidationIssue(
              "invalid-energy-field",
              {
                field,
                value:
                  energies[field]
              }
            )
        )
    };
  }

  const residualKWh =
    energies.initialStoredEnergyKWh +
    energies.generatedEnergyKWh -
    energies.hydraulicEnergyExtractedKWh -
    energies.finalStoredEnergyKWh;

  return {
    minuteIndex:
      minuteResult.minuteIndex,

    valid:
      Math.abs(residualKWh) <=
      toleranceKWh,

    toleranceKWh,

    residualKWh,

    absoluteResidualKWh:
      Math.abs(residualKWh),

    reportedResidualKWh:
      isFiniteNumber(
        energies.minuteBalanceResidualKWh
      )
        ? energies.minuteBalanceResidualKWh
        : null,

    issues: []
  };
}

/**
 * Valida un balance energético agregado.
 *
 * Egenerada + Einicial - Efinal
 * =
 * Edemanda cubierta + Epérdidas de recirculación
 */
function validatePeriodEnergyBalance(
  periodTotals,
  toleranceKWh =
    ACS_VALIDATION_DEFAULTS
      .ENERGY_TOLERANCE_KWH
) {
  if (
    !periodTotals ||
    typeof periodTotals !== "object"
  ) {
    throw new ACSSimulationError(
      "periodTotals es obligatorio."
    );
  }

  requireNonNegativeNumber(
    toleranceKWh,
    "toleranceKWh"
  );

  const energy =
    periodTotals.energy;

  if (
    !energy ||
    typeof energy !== "object"
  ) {
    return {
      valid: false,
      toleranceKWh,
      issues: [
        createValidationIssue(
          "missing-period-energy"
        )
      ]
    };
  }

  const leftSideKWh =
    energy.generatedEnergyKWh +
    energy.initialStoredEnergyKWh -
    energy.finalStoredEnergyKWh;

  const rightSideKWh =
    energy.coveredDemandEnergyKWh +
    energy.recirculationLossKWh;

  const residualKWh =
    leftSideKWh -
    rightSideKWh;

  return {
    valid:
      Math.abs(residualKWh) <=
      toleranceKWh,

    toleranceKWh,

    residualKWh,

    absoluteResidualKWh:
      Math.abs(residualKWh),

    leftSideKWh,
    rightSideKWh,

    reportedResidualKWh:
      isFiniteNumber(
        energy.balanceResidualKWh
      )
        ? energy.balanceResidualKWh
        : (
            isFiniteNumber(
              energy.hourlyBalanceResidualKWh
            )
              ? energy.hourlyBalanceResidualKWh
              : null
          ),

    values: {
      generatedEnergyKWh:
        energy.generatedEnergyKWh,

      initialStoredEnergyKWh:
        energy.initialStoredEnergyKWh,

      finalStoredEnergyKWh:
        energy.finalStoredEnergyKWh,

      coveredDemandEnergyKWh:
        energy.coveredDemandEnergyKWh,

      recirculationLossKWh:
        energy.recirculationLossKWh
    },

    issues: []
  };
}

/**
 * Valida todas las horas.
 */
function validateHourlyEnergyBalances(
  hourlyResults,
  toleranceKWh =
    ACS_VALIDATION_DEFAULTS
      .ENERGY_TOLERANCE_KWH
) {
  if (!Array.isArray(hourlyResults)) {
    throw new ACSSimulationError(
      "hourlyResults debe ser un array."
    );
  }

  const hours =
    hourlyResults.map(
      hour => {
        const validation =
          validatePeriodEnergyBalance(
            hour,
            toleranceKWh
          );

        return {
          hourIndex:
            hour.hourIndex,

          ...validation
        };
      }
    );

  const failedHours =
    hours.filter(
      hour =>
        !hour.valid
    );

  return {
    valid:
      failedHours.length === 0,

    toleranceKWh,

    failedCount:
      failedHours.length,

    failedHours,

    hours
  };
}

/**
 * Valida que la demanda referida a 60 °C se haya convertido
 * correctamente al volumen equivalente a Tuso.
 */
function validateDemandReferenceConversion(
  simulationResult,
  options = {}
) {
  const volumeToleranceL =
    getValidationOption(
      options,
      "volumeToleranceL",
      ACS_VALIDATION_DEFAULTS
        .VOLUME_TOLERANCE_L
    );

  const config =
    simulationResult.config;

  const failures = [];

  if (
    !Array.isArray(
      config.hourlyDemandAt60CL
    ) ||
    !Array.isArray(
      config.hourlyDemandL
    )
  ) {
    return {
      valid: false,

      failedCount: 1,

      failures: [
        createValidationIssue(
          "missing-demand-profiles"
        )
      ]
    };
  }

  if (
    config.hourlyDemandAt60CL.length !==
    config.hourlyDemandL.length
  ) {
    return {
      valid: false,

      failedCount: 1,

      failures: [
        createValidationIssue(
          "demand-profile-length-mismatch",
          {
            at60Length:
              config.hourlyDemandAt60CL.length,

            useLength:
              config.hourlyDemandL.length
          }
        )
      ]
    };
  }

  config
    .hourlyDemandAt60CL
    .forEach(
      (
        volumeAt60CL,
        hourIndex
      ) => {
        const expectedUseVolumeL =
          convertDemandVolumeAt60ToUseTemperature(
            volumeAt60CL,
            config.networkTemperatureC,
            config.useTemperatureC
          );

        const reportedUseVolumeL =
          config.hourlyDemandL[
            hourIndex
          ];

        const differenceL =
          reportedUseVolumeL -
          expectedUseVolumeL;

        if (
          Math.abs(differenceL) >
          volumeToleranceL
        ) {
          failures.push({
            hourIndex,

            volumeAt60CL,

            expectedUseVolumeL,

            reportedUseVolumeL,

            differenceL
          });
        }
      }
    );

  return {
    valid:
      failures.length === 0,

    referenceTemperatureC:
      config.demandReferenceTemperatureC,

    volumeToleranceL,

    failedCount:
      failures.length,

    failures
  };
}

/**
 * Valida la equivalencia energética directa:
 *
 * V60 · Cp · (60 - Tred)
 * =
 * Vuso · Cp · (Tuso - Tred)
 */
function validateDemandEnergyEquivalence(
  simulationResult,
  options = {}
) {
  const energyToleranceKWh =
    getValidationOption(
      options,
      "energyToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .ENERGY_TOLERANCE_KWH
    );

  const config =
    simulationResult.config;

  const failures = [];

  config
    .hourlyDemandAt60CL
    .forEach(
      (
        volumeAt60CL,
        hourIndex
      ) => {
        const useVolumeL =
          config.hourlyDemandL[
            hourIndex
          ];

        const energyAt60KWh =
          waterEnergyRelativeToNetwork(
            volumeAt60CL,
            60,
            config.networkTemperatureC
          );

        const energyAtUseKWh =
          waterEnergyRelativeToNetwork(
            useVolumeL,
            config.useTemperatureC,
            config.networkTemperatureC
          );

        const residualKWh =
          energyAt60KWh -
          energyAtUseKWh;

        if (
          Math.abs(residualKWh) >
          energyToleranceKWh
        ) {
          failures.push({
            hourIndex,

            volumeAt60CL,

            useVolumeL,

            energyAt60KWh,

            energyAtUseKWh,

            residualKWh
          });
        }
      }
    );

  return {
    valid:
      failures.length === 0,

    energyToleranceKWh,

    failedCount:
      failures.length,

    failures
  };
}

/**
 * Valida la demanda energética de cada minuto.
 */
function validateMinuteDemandConsistency(
  minuteResults,
  config,
  options = {}
) {
  if (!Array.isArray(minuteResults)) {
    throw new ACSSimulationError(
      "minuteResults debe ser un array."
    );
  }

  const energyToleranceKWh =
    getValidationOption(
      options,
      "energyToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .ENERGY_TOLERANCE_KWH
    );

  const volumeToleranceL =
    getValidationOption(
      options,
      "volumeToleranceL",
      ACS_VALIDATION_DEFAULTS
        .VOLUME_TOLERANCE_L
    );

  const failures = [];

  minuteResults.forEach(
    result => {
      const expectedMinuteDemand =
        getMinuteDemand(
          config.hourlyDemandL,
          result.minuteIndex
        );

      const reportedVolumeL =
        result
          .comfort
          .equivalentDemandVolumeL;

      const expectedEnergyKWh =
        calculateDemandEnergyKWh(
          expectedMinuteDemand
            .equivalentDemandVolumeL,

          config.useTemperatureC,

          config.networkTemperatureC
        );

      const reportedEnergyKWh =
        result
          .energies
          .requestedDemandEnergyKWh;

      const volumeDifferenceL =
        reportedVolumeL -
        expectedMinuteDemand
          .equivalentDemandVolumeL;

      const energyDifferenceKWh =
        reportedEnergyKWh -
        expectedEnergyKWh;

      if (
        Math.abs(volumeDifferenceL) >
          volumeToleranceL ||
        Math.abs(energyDifferenceKWh) >
          energyToleranceKWh
      ) {
        failures.push({
          minuteIndex:
            result.minuteIndex,

          reportedVolumeL,

          expectedVolumeL:
            expectedMinuteDemand
              .equivalentDemandVolumeL,

          volumeDifferenceL,

          reportedEnergyKWh,

          expectedEnergyKWh,

          energyDifferenceKWh
        });
      }
    }
  );

  return {
    valid:
      failures.length === 0,

    energyToleranceKWh,
    volumeToleranceL,

    failedCount:
      failures.length,

    failures
  };
}

/**
 * Valida el reparto de la recirculación con bypass.
 *
 * Comprueba:
 * - Vrec = Vdep + Vbypass.
 * - Vdepósitos = Vred + Vrec_dep.
 * - Ningún volumen es negativo.
 * - El bypass no supera el total recirculado.
 */
function validateMinuteBypassHydraulics(
  minuteResult,
  options = {}
) {
  const toleranceL =
    getValidationOption(
      options,
      "hydraulicToleranceL",
      ACS_VALIDATION_DEFAULTS
        .HYDRAULIC_TOLERANCE_L
    );

  const hydraulicState =
    minuteResult
      .iterativeResolution
      .hydraulicState;

  const issues = [];

  const requiredFields = [
    "recirculationVolumeL",
    "tankRecirculationVolumeL",
    "bypassRecirculationVolumeL",
    "networkReplacementVolumeL",
    "totalVolumeThroughTanksL"
  ];

  requiredFields.forEach(
    field => {
      if (
        !isFiniteNumber(
          hydraulicState[field]
        )
      ) {
        issues.push(
          createValidationIssue(
            "invalid-hydraulic-field",
            {
              field,
              value:
                hydraulicState[field]
            }
          )
        );
      }
    }
  );

  if (issues.length > 0) {
    return {
      minuteIndex:
        minuteResult.minuteIndex,

      valid: false,

      toleranceL,

      issues
    };
  }

  const recirculationSplitResidualL =
    hydraulicState
      .recirculationVolumeL -
    (
      hydraulicState
        .tankRecirculationVolumeL +
      hydraulicState
        .bypassRecirculationVolumeL
    );

  const tankCircuitResidualL =
    hydraulicState
      .networkReplacementVolumeL +
    hydraulicState
      .tankRecirculationVolumeL -
    hydraulicState
      .totalVolumeThroughTanksL;

  const valuesToCheck = [
    [
      "recirculationVolumeL",
      hydraulicState
        .recirculationVolumeL
    ],
    [
      "tankRecirculationVolumeL",
      hydraulicState
        .tankRecirculationVolumeL
    ],
    [
      "bypassRecirculationVolumeL",
      hydraulicState
        .bypassRecirculationVolumeL
    ],
    [
      "networkReplacementVolumeL",
      hydraulicState
        .networkReplacementVolumeL
    ],
    [
      "totalVolumeThroughTanksL",
      hydraulicState
        .totalVolumeThroughTanksL
    ]
  ];

  valuesToCheck.forEach(
    ([field, value]) => {
      if (value < -toleranceL) {
        issues.push(
          createValidationIssue(
            "negative-hydraulic-volume",
            {
              field,
              value
            }
          )
        );
      }
    }
  );

  if (
    Math.abs(
      recirculationSplitResidualL
    ) > toleranceL
  ) {
    issues.push(
      createValidationIssue(
        "recirculation-split-imbalance",
        {
          residualL:
            recirculationSplitResidualL
        }
      )
    );
  }

  if (
    Math.abs(
      tankCircuitResidualL
    ) > toleranceL
  ) {
    issues.push(
      createValidationIssue(
        "tank-circuit-imbalance",
        {
          residualL:
            tankCircuitResidualL
        }
      )
    );
  }

  if (
    hydraulicState
      .bypassRecirculationVolumeL >
    hydraulicState
      .recirculationVolumeL +
      toleranceL
  ) {
    issues.push(
      createValidationIssue(
        "bypass-exceeds-total-recirculation",
        {
          bypassRecirculationVolumeL:
            hydraulicState
              .bypassRecirculationVolumeL,

          recirculationVolumeL:
            hydraulicState
              .recirculationVolumeL
        }
      )
    );
  }

  return {
    minuteIndex:
      minuteResult.minuteIndex,

    valid:
      issues.length === 0,

    toleranceL,

    recirculationSplitResidualL,

    tankCircuitResidualL,

    issues
  };
}

/**
 * Valida todos los minutos del bypass.
 */
function validateAllBypassHydraulics(
  minuteResults,
  options = {}
) {
  if (!Array.isArray(minuteResults)) {
    throw new ACSSimulationError(
      "minuteResults debe ser un array."
    );
  }

  const minutes =
    minuteResults.map(
      result =>
        validateMinuteBypassHydraulics(
          result,
          options
        )
    );

  const failures =
    minutes.filter(
      validation =>
        !validation.valid
    );

  return {
    valid:
      failures.length === 0,

    failedCount:
      failures.length,

    failures,

    minutes
  };
}

/**
 * Valida la energía perdida en recirculación.
 */
function validateMinuteRecirculationLoss(
  minuteResult,
  options = {}
) {
  const toleranceKWh =
    getValidationOption(
      options,
      "energyToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .ENERGY_TOLERANCE_KWH
    );

  const hydraulicState =
    minuteResult
      .iterativeResolution
      .hydraulicState;

  const expectedLossKWh =
    calculateRecirculationLossKWh({
      recirculationVolumeL:
        hydraulicState
          .recirculationVolumeL,

      supplyTemperatureC:
        hydraulicState
          .actualUseTemperatureC,

      returnTemperatureC:
        hydraulicState
          .returnTemperatureC
    });

  const reportedLossKWh =
    minuteResult
      .energies
      .recirculationLossKWh;

  const residualKWh =
    reportedLossKWh -
    expectedLossKWh;

  return {
    minuteIndex:
      minuteResult.minuteIndex,

    valid:
      Math.abs(residualKWh) <=
      toleranceKWh,

    toleranceKWh,

    reportedLossKWh,

    expectedLossKWh,

    residualKWh
  };
}

/**
 * Valida las pérdidas de recirculación de todos los minutos.
 */
function validateAllRecirculationLosses(
  minuteResults,
  options = {}
) {
  const minutes =
    minuteResults.map(
      result =>
        validateMinuteRecirculationLoss(
          result,
          options
        )
    );

  const failures =
    minutes.filter(
      validation =>
        !validation.valid
    );

  return {
    valid:
      failures.length === 0,

    failedCount:
      failures.length,

    failures,

    minutes
  };
}

/**
 * Valida que la temperatura real de uso se mantenga entre
 * Tred y Tuso.
 */
function validateUseTemperatureLimits(
  minuteResults,
  config,
  options = {}
) {
  const toleranceC =
    getValidationOption(
      options,
      "temperatureToleranceC",
      ACS_VALIDATION_DEFAULTS
        .TEMPERATURE_TOLERANCE_C
    );

  const failures = [];

  minuteResults.forEach(
    result => {
      const temperatureC =
        result
          .comfort
          .actualUseTemperatureC;

      if (
        !isWithinRangeWithTolerance(
          temperatureC,
          config.networkTemperatureC,
          config.useTemperatureC,
          toleranceC
        )
      ) {
        failures.push({
          minuteIndex:
            result.minuteIndex,

          temperatureC,

          minimum:
            config.networkTemperatureC,

          maximum:
            config.useTemperatureC
        });
      }
    }
  );

  return {
    valid:
      failures.length === 0,

    toleranceC,

    failedCount:
      failures.length,

    failures
  };
}

/**
 * Valida la equivalencia entre energía cubierta/no cubierta
 * y sus volúmenes equivalentes a Tuso.
 */
function validateDemandCoverageEquivalence(
  minuteResults,
  config,
  options = {}
) {
  const toleranceKWh =
    getValidationOption(
      options,
      "energyToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .ENERGY_TOLERANCE_KWH
    );

  const deltaTemperatureC =
    config.useTemperatureC -
    config.networkTemperatureC;

  const failures = [];

  minuteResults.forEach(
    result => {
      const coveredVolumeL =
        result
          .comfort
          .coveredEquivalentVolumeL;

      const uncoveredVolumeL =
        result
          .comfort
          .uncoveredEquivalentVolumeL;

      const calculatedCoveredEnergyKWh =
        waterEnergyFromDeltaTemperature(
          coveredVolumeL,
          deltaTemperatureC
        );

      const calculatedUncoveredEnergyKWh =
        waterEnergyFromDeltaTemperature(
          uncoveredVolumeL,
          deltaTemperatureC
        );

      const reportedCoveredEnergyKWh =
        result
          .energies
          .coveredDemandEnergyKWh;

      const reportedUncoveredEnergyKWh =
        result
          .energies
          .uncoveredDemandEnergyKWh;

      const coveredResidualKWh =
        reportedCoveredEnergyKWh -
        calculatedCoveredEnergyKWh;

      const uncoveredResidualKWh =
        reportedUncoveredEnergyKWh -
        calculatedUncoveredEnergyKWh;

      const demandResidualKWh =
        result
          .energies
          .requestedDemandEnergyKWh -
        (
          reportedCoveredEnergyKWh +
          reportedUncoveredEnergyKWh
        );

      if (
        Math.abs(coveredResidualKWh) >
          toleranceKWh ||
        Math.abs(uncoveredResidualKWh) >
          toleranceKWh ||
        Math.abs(demandResidualKWh) >
          toleranceKWh
      ) {
        failures.push({
          minuteIndex:
            result.minuteIndex,

          coveredResidualKWh,

          uncoveredResidualKWh,

          demandResidualKWh
        });
      }
    }
  );

  return {
    valid:
      failures.length === 0,

    toleranceKWh,

    failedCount:
      failures.length,

    failures
  };
}

/**
 * Valida continuidad energética entre minutos:
 *
 * Efinal(n - 1) = Einicial(n)
 */
function validateMinuteEnergyContinuity(
  minuteResults,
  options = {}
) {
  const toleranceKWh =
    getValidationOption(
      options,
      "energyToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .ENERGY_TOLERANCE_KWH
    );

  const failures = [];

  for (
    let index = 1;
    index < minuteResults.length;
    index += 1
  ) {
    const previous =
      minuteResults[index - 1];

    const current =
      minuteResults[index];

    const residualKWh =
      previous
        .energies
        .finalStoredEnergyKWh -
      current
        .energies
        .initialStoredEnergyKWh;

    if (
      Math.abs(residualKWh) >
      toleranceKWh
    ) {
      failures.push({
        previousMinuteIndex:
          previous.minuteIndex,

        currentMinuteIndex:
          current.minuteIndex,

        residualKWh
      });
    }
  }

  return {
    valid:
      failures.length === 0,

    toleranceKWh,

    failedCount:
      failures.length,

    failures
  };
}

/**
 * Valida el control y la potencia del generador.
 */
function validateGeneratorResults(
  minuteResults,
  config,
  options = {}
) {
  const toleranceKWh =
    getValidationOption(
      options,
      "energyToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .ENERGY_TOLERANCE_KWH
    );

  const failures = [];

  minuteResults.forEach(
    result => {
      const generation =
        result.generation;

      const maximumMinuteEnergyKWh =
        powerToEnergy(
          config.generatorPowerKW,
          1
        );

      if (
        generation.absorbedEnergyKWh >
        maximumMinuteEnergyKWh +
        toleranceKWh
      ) {
        failures.push({
          minuteIndex:
            result.minuteIndex,

          type:
            "generator-energy-exceeds-power",

          absorbedEnergyKWh:
            generation.absorbedEnergyKWh,

          maximumMinuteEnergyKWh
        });
      }

      generation
        .tankResults
        .forEach(
          tank => {
            const availablePowerKW =
              isFiniteNumber(
                tank.availableExchangerPowerKW
              )
                ? tank.availableExchangerPowerKW
                : tank.nominalExchangerPowerKW;

            if (
              isFiniteNumber(
                tank.assignedPowerKW
              ) &&
              isFiniteNumber(
                availablePowerKW
              ) &&
              tank.assignedPowerKW >
                availablePowerKW +
                ACS_VALIDATION_DEFAULTS
                  .POWER_TOLERANCE_KW
            ) {
              failures.push({
                minuteIndex:
                  result.minuteIndex,

                tankId:
                  tank.tankId,

                type:
                  "assigned-power-exceeds-effective-exchanger-power",

                assignedPowerKW:
                  tank.assignedPowerKW,

                availableExchangerPowerKW:
                  availablePowerKW
              });
            }

            if (
              isFiniteNumber(
                tank.thermalCorrectionFactor
              ) &&
              !isWithinRangeWithTolerance(
                tank.thermalCorrectionFactor,
                0,
                1,
                ACS_VALIDATION_DEFAULTS
                  .CORRECTION_FACTOR_TOLERANCE
              )
            ) {
              failures.push({
                minuteIndex:
                  result.minuteIndex,

                tankId:
                  tank.tankId,

                type:
                  "generation-correction-factor-out-of-range",

                thermalCorrectionFactor:
                  tank.thermalCorrectionFactor
              });
            }
          }
        );

      const tankEnergySumKWh =
        generation
          .tankResults
          .reduce(
            (
              total,
              tank
            ) =>
              total +
              tank.absorbedEnergyKWh,
            0
          );

      if (
        Math.abs(
          tankEnergySumKWh -
          generation.absorbedEnergyKWh
        ) >
        toleranceKWh
      ) {
        failures.push({
          minuteIndex:
            result.minuteIndex,

          type:
            "tank-generation-sum-mismatch",

          tankEnergySumKWh,

          absorbedEnergyKWh:
            generation.absorbedEnergyKWh
        });
      }

      if (
        !generation.generatorRunning &&
        generation.absorbedEnergyKWh >
          toleranceKWh
      ) {
        failures.push({
          minuteIndex:
            result.minuteIndex,

          type:
            "energy-generated-while-stopped",

          absorbedEnergyKWh:
            generation.absorbedEnergyKWh
        });
      }
    }
  );

  return {
    valid:
      failures.length === 0,

    toleranceKWh,

    failedCount:
      failures.length,

    failures
  };
}

/**
 * Valida todos los minutos.
 */
function validateAllMinutes(
  minuteResults,
  config,
  options = {}
) {
  if (!Array.isArray(minuteResults)) {
    throw new ACSSimulationError(
      "minuteResults debe ser un array."
    );
  }

  const toleranceKWh =
    getValidationOption(
      options,
      "energyToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .ENERGY_TOLERANCE_KWH
    );

  const energy = [];
  const physicalStates = [];
  const convergenceFailures = [];

  minuteResults.forEach(
    minuteResult => {
      energy.push(
        validateMinuteEnergyBalance(
          minuteResult,
          toleranceKWh
        )
      );

      physicalStates.push(
        validateMinuteTankStates(
          minuteResult,
          options
        )
      );

      if (
        !minuteResult
          .iterativeResolution
          .converged
      ) {
        convergenceFailures.push({
          minuteIndex:
            minuteResult.minuteIndex,

          iterations:
            minuteResult
              .iterativeResolution
              .iterations
        });
      }
    }
  );

  const failedEnergy =
    energy.filter(
      validation =>
        !validation.valid
    );

  const failedPhysicalStates =
    physicalStates.filter(
      validation =>
        !validation.valid
    );

  const demandConsistency =
    validateMinuteDemandConsistency(
      minuteResults,
      config,
      options
    );

  const bypassHydraulics =
    validateAllBypassHydraulics(
      minuteResults,
      options
    );

  const recirculationLosses =
    validateAllRecirculationLosses(
      minuteResults,
      options
    );

  const demandCoverageEquivalence =
    validateDemandCoverageEquivalence(
      minuteResults,
      config,
      options
    );

  const useTemperatureLimits =
    validateUseTemperatureLimits(
      minuteResults,
      config,
      options
    );

  const energyContinuity =
    validateMinuteEnergyContinuity(
      minuteResults,
      options
    );

  const generator =
    validateGeneratorResults(
      minuteResults,
      config,
      options
    );

  const convergence = {
    valid:
      convergenceFailures.length === 0,

    failedCount:
      convergenceFailures.length,

    failures:
      convergenceFailures
  };

  return {
    valid:
      failedEnergy.length === 0 &&
      failedPhysicalStates.length === 0 &&
      convergence.valid &&
      demandConsistency.valid &&
      bypassHydraulics.valid &&
      recirculationLosses.valid &&
      demandCoverageEquivalence.valid &&
      useTemperatureLimits.valid &&
      energyContinuity.valid &&
      generator.valid,

    energy: {
      valid:
        failedEnergy.length === 0,

      failedCount:
        failedEnergy.length,

      failures:
        failedEnergy
    },

    physicalStates: {
      valid:
        failedPhysicalStates.length === 0,

      failedCount:
        failedPhysicalStates.length,

      failures:
        failedPhysicalStates
    },

    convergence,

    demandConsistency,

    bypassHydraulics,

    recirculationLosses,

    demandCoverageEquivalence,

    useTemperatureLimits,

    energyContinuity,

    generator
  };
}

/**
 * Ejecuta la validación integral de una simulación.
 */
function validateSimulation(
  simulationResult,
  options = {}
) {
  const structure =
    validateSimulationStructure(
      simulationResult
    );

  if (!structure.valid) {
    return {
      valid: false,
      structure
    };
  }

  const toleranceKWh =
    getValidationOption(
      options,
      "energyToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .ENERGY_TOLERANCE_KWH
    );

  const completeMinuteResults =
    simulationResult
      .results
      .completeSimulation
      .minute;

  if (
    !Array.isArray(
      completeMinuteResults
    )
  ) {
    throw new ACSSimulationError(
      "La simulación debe incluir resultados de minuto. Usa includeMinuteResults: true."
    );
  }

  const analysisMinuteResults =
    simulationResult
      .results
      .analysis
      .minute;

  const completeHourlyResults =
    simulationResult
      .results
      .completeSimulation
      .hourly;

  const analysisHourlyResults =
    simulationResult
      .results
      .analysis
      .hourly;

  const config =
    simulationResult.config;

  const demandReferenceConversion =
    validateDemandReferenceConversion(
      simulationResult,
      options
    );

  const demandEnergyEquivalence =
    validateDemandEnergyEquivalence(
      simulationResult,
      options
    );

  const minuteValidation =
    validateAllMinutes(
      completeMinuteResults,
      config,
      options
    );

  const completeHourlyBalance =
    validateHourlyEnergyBalances(
      completeHourlyResults,
      toleranceKWh
    );

  const analysisHourlyBalance =
    validateHourlyEnergyBalances(
      analysisHourlyResults,
      toleranceKWh
    );

  const analysisBalance =
    validatePeriodEnergyBalance(
      simulationResult
        .results
        .analysis
        .totals,

      toleranceKWh
    );

  const completeBalance =
    validatePeriodEnergyBalance(
      simulationResult
        .results
        .completeSimulation
        .totals,

      toleranceKWh
    );

  const temporalContinuity =
    validateTemporalContinuity(
      completeMinuteResults
    );

  const analysisMinuteCountValid =
    Array.isArray(
      analysisMinuteResults
    ) &&
    analysisMinuteResults.length ===
      (
        config.simulationMinutes -
        config.stabilizationMinutes
      );

  const periodStructure = {
    valid:
      completeHourlyResults.length ===
        config.simulationHours &&
      analysisHourlyResults.length ===
        (
          config.simulationHours -
          config.stabilizationHours
        ) &&
      completeMinuteResults.length ===
        config.simulationMinutes &&
      analysisMinuteCountValid,

    completeHourCount:
      completeHourlyResults.length,

    expectedCompleteHourCount:
      config.simulationHours,

    analysisHourCount:
      analysisHourlyResults.length,

    expectedAnalysisHourCount:
      config.simulationHours -
      config.stabilizationHours,

    completeMinuteCount:
      completeMinuteResults.length,

    expectedCompleteMinuteCount:
      config.simulationMinutes,

    analysisMinuteCount:
      Array.isArray(
        analysisMinuteResults
      )
        ? analysisMinuteResults.length
        : null,

    expectedAnalysisMinuteCount:
      config.simulationMinutes -
      config.stabilizationMinutes
  };

  return {
    valid:
      structure.valid &&
      demandReferenceConversion.valid &&
      demandEnergyEquivalence.valid &&
      minuteValidation.valid &&
      completeHourlyBalance.valid &&
      analysisHourlyBalance.valid &&
      analysisBalance.valid &&
      completeBalance.valid &&
      temporalContinuity.valid &&
      periodStructure.valid,

    options: {
      energyToleranceKWh:
        toleranceKWh,

      hydraulicToleranceL:
        getValidationOption(
          options,
          "hydraulicToleranceL",
          ACS_VALIDATION_DEFAULTS
            .HYDRAULIC_TOLERANCE_L
        ),

      temperatureToleranceC:
        getValidationOption(
          options,
          "temperatureToleranceC",
          ACS_VALIDATION_DEFAULTS
            .TEMPERATURE_TOLERANCE_C
        ),

      volumeToleranceL:
        getValidationOption(
          options,
          "volumeToleranceL",
          ACS_VALIDATION_DEFAULTS
            .VOLUME_TOLERANCE_L
        )
    },

    structure,

    periodStructure,

    demandReferenceConversion,

    demandEnergyEquivalence,

    minuteValidation,

    completeHourlyBalance,

    analysisHourlyBalance,

    analysisBalance,

    completeBalance,

    temporalContinuity
  };
}

/**
 * Compara dos resultados numéricos.
 */
function compareSimulationValue(
  name,
  valueA,
  valueB,
  absoluteTolerance,
  percentTolerance
) {
  const absoluteDifference =
    Math.abs(
      valueA -
      valueB
    );

  const percentDifference =
    calculatePercentDifference(
      valueA,
      valueB
    );

  return {
    name,

    valueA,
    valueB,

    absoluteDifference,
    percentDifference,

    valid:
      absoluteDifference <=
        absoluteTolerance ||
      percentDifference <=
        percentTolerance
  };
}

/**
 * Crea una configuración equivalente con D2 casi nulo.
 */
function createNearZeroSecondTankConfig(
  singleTankConfig,
  options = {}
) {
  if (
    !singleTankConfig ||
    typeof singleTankConfig !== "object"
  ) {
    throw new ACSSimulationError(
      "singleTankConfig es obligatorio."
    );
  }

  if (singleTankConfig.tankCount !== 1) {
    throw new ACSSimulationError(
      "La configuración original debe tener un depósito."
    );
  }

  const secondTankVolumeL =
    options.secondTankVolumeL === undefined
      ? 1e-6
      : requirePositiveNumber(
          options.secondTankVolumeL,
          "options.secondTankVolumeL"
        );

  const secondTankExchangerPowerKW =
    options.secondTankExchangerPowerKW === undefined
      ? 0
      : requireNonNegativeNumber(
          options.secondTankExchangerPowerKW,
          "options.secondTankExchangerPowerKW"
        );

  return {
    ...cloneObject(
      singleTankConfig
    ),

    tankCount: 2,

    tanks: [
      cloneObject(
        singleTankConfig.tanks[0]
      ),

      {
        volumeL:
          secondTankVolumeL,

        exchangerType:
          ACS_EXCHANGER_TYPES.PLATE,

        exchangerPowerKW:
          secondTankExchangerPowerKW
      }
    ]
  };
}

/**
 * Comprueba la equivalencia entre:
 * - instalación de un depósito;
 * - instalación de dos depósitos con D2 casi nulo.
 */
function validateSingleVsNearZeroSecondTank(
  singleTankConfig,
  options = {}
) {
  const absoluteTolerance =
    getValidationOption(
      options,
      "absoluteToleranceKWh",
      ACS_VALIDATION_DEFAULTS
        .EQUIVALENCE_ABSOLUTE_TOLERANCE_KWH
    );

  const percentTolerance =
    getValidationOption(
      options,
      "percentTolerance",
      ACS_VALIDATION_DEFAULTS
        .EQUIVALENCE_PERCENT_TOLERANCE
    );

  const twoTankConfig =
    createNearZeroSecondTankConfig(
      singleTankConfig,
      options
    );

  const oneTankResult =
    simulateACS(
      singleTankConfig,
      {
        includeMinuteResults: false
      }
    );

  const twoTankResult =
    simulateACS(
      twoTankConfig,
      {
        includeMinuteResults: false
      }
    );

  const oneTankTotals =
    oneTankResult
      .results
      .analysis
      .totals;

  const twoTankTotals =
    twoTankResult
      .results
      .analysis
      .totals;

  const comparisons = [
    compareSimulationValue(
      "generatedEnergyKWh",

      oneTankTotals
        .energy
        .generatedEnergyKWh,

      twoTankTotals
        .energy
        .generatedEnergyKWh,

      absoluteTolerance,
      percentTolerance
    ),

    compareSimulationValue(
      "coveredDemandEnergyKWh",

      oneTankTotals
        .energy
        .coveredDemandEnergyKWh,

      twoTankTotals
        .energy
        .coveredDemandEnergyKWh,

      absoluteTolerance,
      percentTolerance
    ),

    compareSimulationValue(
      "uncoveredDemandEnergyKWh",

      oneTankTotals
        .energy
        .uncoveredDemandEnergyKWh,

      twoTankTotals
        .energy
        .uncoveredDemandEnergyKWh,

      absoluteTolerance,
      percentTolerance
    ),

    compareSimulationValue(
      "recirculationLossKWh",

      oneTankTotals
        .energy
        .recirculationLossKWh,

      twoTankTotals
        .energy
        .recirculationLossKWh,

      absoluteTolerance,
      percentTolerance
    ),

    compareSimulationValue(
      "generatorRunningHours",

      oneTankTotals
        .generator
        .runningHours,

      twoTankTotals
        .generator
        .runningHours,

      absoluteTolerance,
      percentTolerance
    ),

    compareSimulationValue(
      "coveragePercent",

      oneTankTotals
        .comfort
        .coveragePercent,

      twoTankTotals
        .comfort
        .coveragePercent,

      percentTolerance,
      percentTolerance
    )
  ];

  return {
    valid:
      comparisons.every(
        comparison =>
          comparison.valid
      ),

    options: {
      absoluteToleranceKWh:
        absoluteTolerance,

      percentTolerance,

      secondTankVolumeL:
        twoTankConfig
          .tanks[1]
          .volumeL,

      secondTankExchangerPowerKW:
        twoTankConfig
          .tanks[1]
          .exchangerPowerKW
    },

    comparisons,

    oneTankSummary:
      createSimulationSummary(
        oneTankResult
      ),

    twoTankSummary:
      createSimulationSummary(
        twoTankResult
      )
  };
}

/**
 * Convierte el resultado horario en una estructura simple
 * para la futura interfaz.
 */
function createUIResult(
  simulationResult
) {
  if (
    !simulationResult ||
    typeof simulationResult !== "object"
  ) {
    throw new ACSSimulationError(
      "simulationResult es obligatorio."
    );
  }

  const summary =
    createSimulationSummary(
      simulationResult
    );

  const config =
    simulationResult.config;

  const hourly =
    simulationResult
      .results
      .analysis
      .hourly;

  return {
    metadata: {
      engineVersion: "1.1.1",

      analysisHours:
        hourly.length,

      tankCount:
        config.tankCount,

      demandReferenceTemperatureC:
        config.demandReferenceTemperatureC,

      useTemperatureC:
        config.useTemperatureC,

      storageTemperatureC:
        config.storageTemperatureC,

      networkTemperatureC:
        config.networkTemperatureC,

      exchangerTypes:
        config.tanks.map(
          tank =>
            tank.exchangerType
        )
    },

    summary,

    hourly:
      hourly.map(
        hour => ({
          hour:
            hour.hourIndex -
            config.stabilizationHours +
            1,

          absoluteHourIndex:
            hour.hourIndex,

          demand: {
            equivalentAtUseTemperatureL:
              hour
                .volume
                .equivalentDemandVolumeL,

            equivalentAt60CL:
              config
                .hourlyDemandAt60CL[
                  hour.hourIndex
                ],

            requestedEnergyKWh:
              hour
                .energy
                .requestedDemandEnergyKWh,

            coveredEnergyKWh:
              hour
                .energy
                .coveredDemandEnergyKWh,

            uncoveredEnergyKWh:
              hour
                .energy
                .uncoveredDemandEnergyKWh,

            coveragePercent:
              hour
                .comfort
                .coveragePercent
          },

          energy: {
            generatedKWh:
              hour
                .energy
                .generatedEnergyKWh,

            recirculationLossKWh:
              hour
                .energy
                .recirculationLossKWh,

            initialStoredKWh:
              hour
                .energy
                .initialStoredEnergyKWh,

            finalStoredKWh:
              hour
                .energy
                .finalStoredEnergyKWh,

            balanceResidualKWh:
              hour
                .energy
                .hourlyBalanceResidualKWh
          },

          comfort: {
            minimumUseTemperatureC:
              hour
                .comfort
                .minimumActualUseTemperatureC,

            maximumUseTemperatureC:
              hour
                .comfort
                .maximumActualUseTemperatureC,

            minutesBelowTarget:
              hour
                .comfort
                .minutesBelowTargetTemperature,

            uncoveredEquivalentVolumeL:
              hour
                .volume
                .uncoveredEquivalentVolumeL
          },

          generator: {
            runningMinutes:
              hour
                .generator
                .runningMinutes,

            runningHours:
              hour
                .generator
                .runningHours,

            starts:
              hour
                .generator
                .starts,

            stops:
              hour
                .generator
                .stops,

            nominalPowerKW:
              hour
                .generator
                .nominalPowerKW,

            requestedPowerKW:
              hour
                .generator
                .requestedPowerKW,

            effectivePowerKW:
              hour
                .generator
                .effectivePowerKW,

            absorbedPowerKW:
              hour
                .generator
                .absorbedPowerKW,

            operatingPowerKW:
              hour
                .generator
                .operatingPowerKW,

            /* Alias directo para gráficas antiguas. */
            powerKW:
              hour
                .generator
                .effectivePowerKW
          },

          sanitary: {
            enabled:
              hour
                .sanitary
                .enabled,

            evaluatedTankId:
              hour
                .sanitary
                .evaluatedTankId,

            minutesBelow60C:
              hour
                .sanitary
                .minutesBelow60C
          },

          convergence: {
            failures:
              hour
                .convergence
                .failures,

            maximumIterationsUsed:
              hour
                .convergence
                .maximumIterationsUsed
          },

          tanks:
            hour.tanks.map(
              tank => ({
                id:
                  tank.tankId,

                initialLoadPercent:
                  tank.initialLoadPercent,

                minimumLoadPercent:
                  tank.minimumLoadPercent,

                maximumLoadPercent:
                  tank.maximumLoadPercent,

                finalLoadPercent:
                  tank.finalLoadPercent,

                /*
                 * Alias de compatibilidad para la gráfica de carga.
                 * Representa la carga al final de cada hora.
                 */
                loadPercent:
                  tank.finalLoadPercent,

                minimumOutletTemperatureC:
                  tank.minimumOutletTemperatureC,

                finalOutletTemperatureC:
                  tank.finalOutletTemperatureC,

                generatedEnergyKWh:
                  tank.generatedEnergyKWh,

                effectiveGenerationMinutes:
                  tank.effectiveGenerationMinutes,

                assignedPowerKW:
                  tank
                    .exchanger
                    .averageAssignedPowerKW,

                effectiveGeneratedPowerKW:
                  tank
                    .exchanger
                    .averageGeneratedPowerKW,

                /* Alias habitual consumido por gráficas de potencia. */
                powerKW:
                  tank
                    .exchanger
                    .averageGeneratedPowerKW,

                exchanger: {
                  type:
                    tank.exchanger
                      .type,

                  nominalPowerKW:
                    tank.exchanger
                      .nominalPowerKW,

                  initialEffectivePowerKW:
                    tank.exchanger
                      .initialEffectivePowerKW,

                  finalEffectivePowerKW:
                    tank.exchanger
                      .finalEffectivePowerKW,

                  minimumEffectivePowerKW:
                    tank.exchanger
                      .minimumEffectivePowerKW,

                  maximumEffectivePowerKW:
                    tank.exchanger
                      .maximumEffectivePowerKW,

                  averageEffectivePowerKW:
                    tank.exchanger
                      .averageEffectivePowerKW,

                  minimumCorrectionFactor:
                    tank.exchanger
                      .minimumCorrectionFactor,

                  maximumCorrectionFactor:
                    tank.exchanger
                      .maximumCorrectionFactor,

                  averageCorrectionFactor:
                    tank.exchanger
                      .averageCorrectionFactor,

                  finalCorrectionFactor:
                    tank.exchanger
                      .finalCorrectionFactor,

                  deratingMinutes:
                    tank.exchanger
                      .deratingMinutes,

                  initialLowerZoneLoadPercent:
                    tank.exchanger
                      .initialLowerZoneLoadPercent,

                  finalLowerZoneLoadPercent:
                    tank.exchanger
                      .finalLowerZoneLoadPercent,

                  minimumLowerZoneTemperatureC:
                    tank.exchanger
                      .minimumLowerZoneTemperatureC,

                  maximumLowerZoneTemperatureC:
                    tank.exchanger
                      .maximumLowerZoneTemperatureC,

                  finalLowerZoneTemperatureC:
                    tank.exchanger
                      .finalLowerZoneTemperatureC,

                  nominalPrimaryInletTemperatureC:
                    tank.exchanger
                      .nominalPrimaryInletTemperatureC,

                  nominalPrimaryOutletTemperatureC:
                    tank.exchanger
                      .nominalPrimaryOutletTemperatureC,

                  nominalSecondaryInletTemperatureC:
                    tank.exchanger
                      .nominalSecondaryInletTemperatureC,

                  nominalSecondaryOutletTemperatureC:
                    tank.exchanger
                      .nominalSecondaryOutletTemperatureC,

                  actualPrimaryInletTemperatureC:
                    tank.exchanger
                      .actualPrimaryInletTemperatureC,

                  actualPrimaryOutletTemperatureC:
                    tank.exchanger
                      .actualPrimaryOutletTemperatureC,

                  nominalTemperatureDifferenceC:
                    tank.exchanger
                      .nominalTemperatureDifferenceC
                }
              })
            )
        })
      )
  };
}

/**
 * Ejecuta la simulación y crea:
 * - resultado completo;
 * - resumen;
 * - salida para interfaz;
 * - validación final.
 */
function runACSSimulation(
  inputConfig,
  options = {}
) {
  const includeMinuteResults =
    options.includeMinuteResults === undefined
      ? true
      : Boolean(
          options.includeMinuteResults
        );

  const simulation =
    simulateACS(
      inputConfig,
      {
        ...options,
        includeMinuteResults
      }
    );

  const summary =
    createSimulationSummary(
      simulation
    );

  const ui =
    createUIResult(
      simulation
    );

  let validation = null;

  if (includeMinuteResults) {
    validation =
      validateSimulation(
        simulation,
        {
          energyToleranceKWh:
            options
              .validationEnergyToleranceKWh,

          hydraulicToleranceL:
            options
              .validationHydraulicToleranceL,

          temperatureToleranceC:
            options
              .validationTemperatureToleranceC,

          volumeToleranceL:
            options
              .validationVolumeToleranceL,

          loadTolerancePercent:
            options
              .validationLoadTolerancePercent
        }
      );
  }

  return {
    simulation,
    summary,
    ui,
    validation
  };
}

/**
 * API pública final del motor.
 *
 * Uso recomendado:
 *
 * const result =
 *   ACSSimulationEngine.run(config);
 */
const ACSSimulationEngine =
  Object.freeze({
    version: "1.1.1",

    constants:
      ACS_CONSTANTS,

    exchangerTypes:
      ACS_EXCHANGER_TYPES,

    validationDefaults:
      ACS_VALIDATION_DEFAULTS,

    simulate:
      simulateACS,

    run:
      runACSSimulation,

    summarize:
      createSimulationSummary,

    createUIResult,

    validate:
      validateSimulation,

    validateEnergyBalance(
      simulationResult,
      toleranceKWh =
        ACS_VALIDATION_DEFAULTS
          .ENERGY_TOLERANCE_KWH
    ) {
      return validatePeriodEnergyBalance(
        simulationResult
          .results
          .analysis
          .totals,

        toleranceKWh
      );
    },

    validateSingleVsNearZeroSecondTank,

    classes:
      Object.freeze({
        ACSTank,
        ACSGeneratorState,
        ACSMinuteHydraulicState,
        ACSSimulationError
      })
  });

/**
 * Exportaciones del Bloque 6.
 */
const ACSBlock6 = {
  ACS_VALIDATION_DEFAULTS,

  getValidationOption,
  isWithinRangeWithTolerance,
  approximatelyEqual,
  calculatePercentDifference,
  createValidationIssue,

  validateSimulationStructure,

  validateTankPhysicalState,
  validateTankExchangerState,
  validateMinuteTankStates,

  validateMinuteEnergyBalance,
  validatePeriodEnergyBalance,
  validateHourlyEnergyBalances,

  validateDemandReferenceConversion,
  validateDemandEnergyEquivalence,
  validateMinuteDemandConsistency,

  validateMinuteBypassHydraulics,
  validateAllBypassHydraulics,

  validateMinuteRecirculationLoss,
  validateAllRecirculationLosses,

  validateUseTemperatureLimits,
  validateDemandCoverageEquivalence,

  validateMinuteEnergyContinuity,
  validateGeneratorResults,

  validateAllMinutes,
  validateSimulation,

  compareSimulationValue,
  createNearZeroSecondTankConfig,
  validateSingleVsNearZeroSecondTank,

  createUIResult,
  runACSSimulation,

  ACSSimulationEngine
};

/**
 * Node.js / CommonJS.
 */
if (
  typeof module !== "undefined" &&
  module.exports
) {
  module.exports = {
    ...module.exports,
    ...ACSBlock6,

    ACSSimulationEngine
  };
}

/**
 * Navegador.
 */
if (typeof window !== "undefined") {
  window.ACSBlock6 =
    ACSBlock6;

  window.ACSSimulationEngine =
    ACSSimulationEngine;

  window.ACS = {
    ...(window.ACS || {}),
    ...(window.ACSBlock1 || {}),
    ...(window.ACSBlock2 || {}),
    ...(window.ACSBlock3 || {}),
    ...(window.ACSBlock4 || {}),
    ...(window.ACSBlock5 || {}),
    ...ACSBlock6
  };
}