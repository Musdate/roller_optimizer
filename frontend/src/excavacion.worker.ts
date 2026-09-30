import { advise, analyze, type Analysis, type Advice, type Computed, type Problem } from "./excavacion";

export interface WorkerRequest {
  id: number;
  problem: Problem;
  target: string;
  budget: number;
}

export interface WorkerResponse {
  id: number;
  analysis: Analysis;
  advice: Advice;
  ms: number;
}

let cacheKey = "";
let cached: Computed | null = null;

self.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  const t0 = performance.now();
  const { id, problem, target, budget } = e.data;
  const key = JSON.stringify(problem);
  if (key !== cacheKey || !cached) {
    cached = analyze(problem);
    cacheKey = key;
  }
  const res: WorkerResponse = {
    id,
    analysis: cached.analysis,
    advice: advise(cached, problem, target, budget),
    ms: performance.now() - t0,
  };
  self.postMessage(res);
});
