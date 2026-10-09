// All volume and financial inputs must cover the same annual period.
function calculateAssessmentMetrics(input = {}) {
  const fields = [
    "currentVolume",
    "projectedVolume",
    "annualCapacity",
    "netRevenuePerCase",
    "variableCostPerCase",
    "additionalAnnualFixedCost",
    "initialInvestment",
  ];

  for (const field of fields) {
    const value = input[field];

    // Require actual numbers; reject blanks, negatives, and Infinity.
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new Error(`${field} must be a non-negative number`);
    }
  }

  if (input.annualCapacity === 0) {
    throw new Error("annualCapacity must be greater than zero");
  }

  const incrementalVolume =
    input.projectedVolume - input.currentVolume;

  const contributionPerCase =
    input.netRevenuePerCase - input.variableCostPerCase;

  const incrementalAnnualContribution =
    incrementalVolume * contributionPerCase -
    input.additionalAnnualFixedCost;

  return {
    incrementalVolume,

    // Growth is undefined when there is no baseline volume.
    volumeGrowthPercent:
      input.currentVolume > 0
        ? (incrementalVolume / input.currentVolume) * 100
        : null,

    projectedCapacityUtilizationPercent:
      (input.projectedVolume / input.annualCapacity) * 100,

    capacityGap:
      Math.max(0, input.projectedVolume - input.annualCapacity),

    contributionPerCase,
    incrementalAnnualContribution,

    // Simple payback assumes a constant annual contribution.
    simplePaybackYears:
      input.initialInvestment === 0
        ? 0
        : incrementalAnnualContribution > 0
          ? input.initialInvestment / incrementalAnnualContribution
          : null,
  };
}

module.exports = { calculateAssessmentMetrics };