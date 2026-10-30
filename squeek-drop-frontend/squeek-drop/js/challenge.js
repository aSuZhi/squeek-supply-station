// Shared, deterministic mapping. These are GAME rules, not Squeekchain protocol rules.
export const PHASE_TICKS = 3600;
export const DURATION_TICKS = PHASE_TICKS * 3;
export function phaseFromSettlement(record, index) {
  const rounds = BigInt(record.throughRound) - BigInt(record.afterRound);
  const average = BigInt(record.workAdded) / (rounds > 0n ? rounds : 1n);
  const weather = average === 0n ? "NAP" : average < 400n ? "JOG" : "ZOOMIES";
  const targetLevel =
    3 + Number(average > 600n ? 2n : average > 250n ? 1n : 0n);
  const quota =
    2 +
    Number(
      BigInt(record.completedBlocks) > 30n
        ? 2n
        : BigInt(record.completedBlocks) > 0n
          ? 1n
          : 0n,
    );
  return {
    index,
    weather,
    targetLevel,
    quota,
    reward: targetLevel * 40,
    startTick: index * PHASE_TICKS,
    endTick: (index + 1) * PHASE_TICKS,
    roundLabel:
      record.afterRound === record.throughRound
        ? record.throughRound
        : `${BigInt(record.afterRound) + 1n}–${record.throughRound}`,
  };
}
export function practiceConfig(seed = "practice") {
  const records = [
    {
      afterRound: "0",
      throughRound: "1",
      workAdded: "0",
      completedBlocks: "0",
    },
    {
      afterRound: "1",
      throughRound: "2",
      workAdded: "300",
      completedBlocks: "20",
    },
    {
      afterRound: "2",
      throughRound: "3",
      workAdded: "650",
      completedBlocks: "45",
    },
  ];
  return {
    seed,
    phases: records.map(phaseFromSettlement),
    durationTicks: DURATION_TICKS,
  };
}
