const {
  calculateAssessmentMetrics,
} = require("../utils/assessmentMetrics");

const sampleInputs = {
  currentVolume: 1000,
  projectedVolume: 1200,
  annualCapacity: 1500,
  netRevenuePerCase: 500,
  variableCostPerCase: 300,
  additionalAnnualFixedCost: 10000,
  initialInvestment: 60000,
};

describe("StratSight assessment metrics", () => {
  test("calculates the sample expansion correctly", () => {
    expect(calculateAssessmentMetrics(sampleInputs)).toEqual({
      incrementalVolume: 200,
      volumeGrowthPercent: 20,
      projectedCapacityUtilizationPercent: 80,
      capacityGap: 0,
      contributionPerCase: 200,
      incrementalAnnualContribution: 30000,
      simplePaybackYears: 2,
    });
  });

  test("recalculates when projected volume changes", () => {
    const result = calculateAssessmentMetrics({
      ...sampleInputs,
      projectedVolume: 1300,
    });

    expect(result.incrementalVolume).toBe(300);
    expect(result.volumeGrowthPercent).toBe(30);
    expect(result.incrementalAnnualContribution).toBe(50000);
    expect(result.simplePaybackYears).toBe(1.2);
    expect(result.projectedCapacityUtilizationPercent)
      .toBeCloseTo(86.67, 2);
  });

  test("identifies volume exceeding capacity", () => {
    const result = calculateAssessmentMetrics({
      ...sampleInputs,
      projectedVolume: 1800,
    });

    expect(result.capacityGap).toBe(300);
    expect(result.projectedCapacityUtilizationPercent).toBe(120);
  });

  test("returns no payback when annual contribution is negative", () => {
    const result = calculateAssessmentMetrics({
      ...sampleInputs,
      additionalAnnualFixedCost: 50000,
    });

    expect(result.incrementalAnnualContribution).toBe(-10000);
    expect(result.simplePaybackYears).toBeNull();
  });

  test("handles a zero starting volume", () => {
    const result = calculateAssessmentMetrics({
      ...sampleInputs,
      currentVolume: 0,
    });

    expect(result.volumeGrowthPercent).toBeNull();
    expect(result.incrementalVolume).toBe(1200);
  });

  test.each([
    ["annualCapacity", 0],
    ["currentVolume", -1],
    ["projectedVolume", "1200"],
    ["netRevenuePerCase", NaN],
    ["variableCostPerCase", Infinity],
    ["additionalAnnualFixedCost", undefined],
    ["initialInvestment", null],
  ])("rejects invalid %s", (field, value) => {
    expect(() =>
      calculateAssessmentMetrics({
        ...sampleInputs,
        [field]: value,
      })
    ).toThrow();
  });
});