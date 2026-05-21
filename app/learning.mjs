export const MASTERY_CORRECT_THRESHOLD = 3;
export const MASTERY_MARGIN = 2;

export function isMastered(progress = {}) {
  const correct = progress.correctCount ?? progress.correct_count ?? 0;
  const wrong = progress.wrongCount ?? progress.wrong_count ?? 0;
  return correct >= MASTERY_CORRECT_THRESHOLD && correct - wrong >= MASTERY_MARGIN;
}

export function progressSummary(items, progressByItem = {}) {
  const total = items.length;
  const mastered = items.filter((item) => isMastered(progressByItem[item.id])).length;
  return {
    total,
    mastered,
    remaining: total - mastered,
    percent: total ? Math.round((mastered / total) * 100) : 100,
  };
}

export function weightedStudyQueue(items, progressByItem = {}, options = {}) {
  const { count = 20, random = Math.random } = options;
  const weighted = [];
  for (const item of items) {
    const progress = progressByItem[item.id] ?? {};
    if (isMastered(progress)) continue;
    const wrong = progress.wrongCount ?? progress.wrong_count ?? 0;
    const correct = progress.correctCount ?? progress.correct_count ?? 0;
    const weight = Math.max(1, 1 + wrong * 2 - Math.floor(correct / 2));
    for (let i = 0; i < weight; i++) weighted.push(item);
  }
  if (!weighted.length) return [];
  const queue = [];
  const pool = [...weighted];
  while (queue.length < count && pool.length) {
    const index = Math.floor(random() * pool.length);
    queue.push(pool.splice(index, 1)[0]);
  }
  return queue;
}
