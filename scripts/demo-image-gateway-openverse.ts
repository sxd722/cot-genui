import type { AddressInfo } from "node:net";
import { createParser, type LibraryJSONSchema, type LibrarySpec } from "@openuidev/lang-core";
import type { CardPlan } from "../src/dsl/modules";
import { ContractImageSearchProvider } from "../src/openui/providers";
import { resolveAssetManifest, validatePublicImageUrlDetailed } from "../src/openui/assetResolver";
import { safeAssetRefs } from "../src/openui/assetTypes";
import { validateAssetCoverage } from "../src/openui/assetCoverage";
import librarySpec from "../src/openui/generated/system-prompt.spec.json";
import { createImageGatewayServer } from "../services/image-gateway/server";

const query = process.argv.slice(2).join(" ").trim() || "Eiffel Tower Paris daylight architecture";
const apiKey = "openverse-demo-local";
const server = createImageGatewayServer({
  apiKey,
  env: { ...process.env, IMAGE_GATEWAY_PROVIDERS: "openverse" },
});

async function publicDohLookup(hostname: string): Promise<Array<{ address: string; family: number }>> {
  const answers = await Promise.all([1, 28].map(async (type) => {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", String(type));
    const response = await fetch(url, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`DoH HTTP ${response.status}`);
    const data = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
    return (data.Answer ?? []).flatMap((answer) => answer.type === type && answer.data
      ? [{ address: answer.data, family: type === 1 ? 4 : 6 }]
      : []);
  }));
  const addresses = answers.flat();
  if (!addresses.length) throw new Error(`DoH returned no public address for ${hostname}`);
  return addresses;
}

const plan: CardPlan = {
  skillName: "Openverse 图片演示",
  reasoning: "验证本地 Image Gateway 到宿主资产解析的完整链路。",
  cards: [{
    id: "openverse_demo",
    title: "图片演示",
    purpose: "展示与查询语义匹配的开放授权图片。",
    blocks: [{
      kind: "image",
      title: "Openverse 搜索结果",
      assetRequest: { kind: "gallery", query, count: 3, role: "gallery", aspect: "wide" },
    }],
  }],
};

async function main() {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}/v1/search`;
  try {
    const result = await resolveAssetManifest(plan, {
      provider: new ContractImageSearchProvider(endpoint, apiKey, { timeoutMs: 10_000 }),
      // Some local VPN/TUN clients map public hostnames into 198.18.0.0/15. The
      // demo uses independent public DNS for validation without weakening the
      // application's default SSRF policy.
      validate: (url) => validatePublicImageUrlDetailed(url, { lookupImpl: publicDohLookup }),
    });
    const safeAssets = safeAssetRefs(result.manifest);
    const openuiArtifact = safeAssets.length ? [
      'root = CardDeck([card], "auto")',
      'card = GeneratedCard("openverse_demo", "图片演示", [gallery], "media", "immersive")',
      `gallery = AssetGallery([${safeAssets.map((asset) => JSON.stringify(asset.id)).join(", ")}], 3)`,
    ].join("\n") : null;
    const parsed = openuiArtifact
      ? createParser((librarySpec as LibrarySpec).schema as LibraryJSONSchema).parse(openuiArtifact)
      : null;
    const assetCoverage = parsed?.root ? validateAssetCoverage(parsed.root, result.manifest) : null;
    const proof = {
      gateway: endpoint,
      query,
      diagnostics: result.diagnostics,
      safeAssets,
      openuiArtifact,
      assetCoverage,
    };
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    if (result.diagnostics.accepted === 0 || !assetCoverage?.valid) process.exitCode = 1;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

void main().catch((error) => {
  process.stderr.write(`Openverse gateway demo failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
