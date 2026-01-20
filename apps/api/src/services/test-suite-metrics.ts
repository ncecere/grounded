export function calculatePassRate(values: {
  passedCases: number;
  totalCases: number;
  skippedCases: number;
}): number {
  const denominator = values.totalCases - values.skippedCases;
  if (denominator <= 0) {
    return 100;
  }

  return (values.passedCases / denominator) * 100;
}

export function calculateRegressionCount(passRates: number[]): number {
  let regressions = 0;

  for (let i = 1; i < passRates.length; i += 1) {
    if (passRates[i] < passRates[i - 1]) {
      regressions += 1;
    }
  }

  return regressions;
}
