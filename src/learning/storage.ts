import type { AdaptivePolicyEntry } from "@/lib/adaptive/types";
import type { GenerationEpisode, LearningExport, LearningSettings, PolicyObservation } from "./types";

const DB_NAME = "cot-genui-learning";
const DB_VERSION = 1;
const STORES = ["episodes", "policies", "policyObservations", "settings"] as const;
type StoreName = (typeof STORES)[number];

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB 仅在浏览器中可用"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("无法打开学习数据库"));
    request.onupgradeneeded = () => {
      const database = request.result;
      STORES.forEach((store) => {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
      });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function write<T>(storeName: StoreName, value: T): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`写入 ${storeName} 失败`));
  });
  database.close();
}

async function readAll<T>(storeName: StoreName): Promise<T[]> {
  const database = await openDatabase();
  const values = await new Promise<T[]>((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error(`读取 ${storeName} 失败`));
  });
  database.close();
  return values;
}

export const putEpisode = (episode: GenerationEpisode) => write("episodes", episode);
export const putPolicy = (policy: AdaptivePolicyEntry) => write("policies", policy);
export const putPolicyObservation = (observation: PolicyObservation) => write("policyObservations", observation);
export const putLearningSettings = (settings: LearningSettings) => write("settings", settings);
export const listEpisodes = () => readAll<GenerationEpisode>("episodes");
export const listPolicies = () => readAll<AdaptivePolicyEntry>("policies");
export const listPolicyObservations = () => readAll<PolicyObservation>("policyObservations");

export async function getLearningSettings(): Promise<LearningSettings> {
  const settings = await readAll<LearningSettings>("settings");
  return settings.find((item) => item.id === "settings") ?? {
    id: "settings",
    enabled: true,
    mode: "manual",
    updatedAt: new Date().toISOString(),
  };
}

export async function exportLearningData(): Promise<LearningExport> {
  const [episodes, policies, observations, settings] = await Promise.all([
    listEpisodes(), listPolicies(), listPolicyObservations(), getLearningSettings(),
  ]);
  return { exportedAt: new Date().toISOString(), episodes, policies, observations, settings };
}

