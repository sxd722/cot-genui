export interface ProfileTrait {
  trait: string;
  confidence: number;
  domains: string[];
  sourceRefs: string[];
}

export interface ProfileDomain {
  name: string;
  summary: string;
  availableSignals: string[];
  recordCount: number;
  freshness?: string;
  retrievalKeys: string[];
}

export interface ProfileSignal {
  fact: string;
  domain: string;
  confidence: number;
  observedAt?: string;
  sourceRefs: string[];
}

export interface ProfileDigest {
  contextHash: string;
  version: "v1";
  generatedAt: string;
  core: {
    demographics: string[];
    homeAndWork: string[];
    household: string[];
    occupation: string[];
    financialPosture: string[];
    healthConstraints: string[];
    persistentPreferences: string[];
  };
  traits: ProfileTrait[];
  domains: ProfileDomain[];
  salientSignals: ProfileSignal[];
  conflicts: Array<{ topic: string; description: string; sourceRefs: string[] }>;
  degraded?: boolean;
}

export interface RetrievalRequest {
  slotNames: string[];
  domains: string[];
  sourcePaths?: string[];
  semanticQuery: string;
  recency?: string;
}

export interface RetrievedEvidence {
  path: string;
  value: unknown;
  domain: string;
  score: number;
}
