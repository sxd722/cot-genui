"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AssetManifest, AssetRecord } from "./assetTypes";

const AssetRegistryContext = createContext<ReadonlyMap<string, AssetRecord>>(new Map());

export function AssetRegistryProvider({ manifest, children }: { manifest?: AssetManifest | null; children: ReactNode }) {
  const records = new Map((manifest?.assets ?? []).map((asset) => [asset.id, asset]));
  return <AssetRegistryContext.Provider value={records}>{children}</AssetRegistryContext.Provider>;
}

export function useAssetRecord(assetRef: string): AssetRecord | undefined {
  return useContext(AssetRegistryContext).get(assetRef);
}
