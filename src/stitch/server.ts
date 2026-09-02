import "server-only";

import { Stitch, StitchToolClient, type Project } from "@google/stitch-sdk";

let runtimeProjectId: string | null = null;
let runtimeProjectIdPromise: Promise<string> | null = null;

export interface StitchProjectSession {
  project: Project;
  close: () => Promise<void>;
}

export type StitchProjectSessionFactory = () => Promise<StitchProjectSession>;

export function isStitchConfigured(): boolean {
  return Boolean(process.env.STITCH_API_KEY?.trim());
}

async function resolveProject(sdk: Stitch): Promise<Project> {
  const configured = process.env.STITCH_PROJECT_ID?.trim();
  if (configured) return sdk.project(configured);
  if (runtimeProjectId) return sdk.project(runtimeProjectId);

  if (!runtimeProjectIdPromise) {
    runtimeProjectIdPromise = sdk.createProject("cot-genui-mvp")
      .then((project) => {
        runtimeProjectId = project.id;
        return project.id;
      })
      .finally(() => {
        runtimeProjectIdPromise = null;
      });
  }

  return sdk.project(await runtimeProjectIdPromise);
}

/**
 * Open one request-scoped MCP client/Protocol. Project identity may be reused,
 * but transports never cross API requests.
 */
export async function openStitchProjectSession(): Promise<StitchProjectSession> {
  if (!isStitchConfigured()) {
    throw new Error("STITCH_API_KEY is not configured");
  }

  const client = new StitchToolClient();
  const sdk = new Stitch(client);
  try {
    const project = await resolveProject(sdk);
    return {
      project,
      close: async () => {
        await client.close();
      },
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

export function isStitchTransportReuseError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Already connected to a transport");
}

/**
 * Run one Stitch operation with an isolated transport. The known stale-
 * transport failure is retried once with a completely new client/Protocol.
 */
export async function withStitchProject<T>(
  operation: (project: Project) => Promise<T>,
  openSession: StitchProjectSessionFactory = openStitchProjectSession,
): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const session = await openSession();
    try {
      return await operation(session.project);
    } catch (error) {
      if (attempt === 2 || !isStitchTransportReuseError(error)) throw error;
      console.warn("[stitch:connection] stale transport detected; retrying with a fresh client", { attempt });
    } finally {
      await session.close().catch((closeError) => {
        console.warn("[stitch:connection] failed to close request-scoped client", {
          message: closeError instanceof Error ? closeError.message : String(closeError),
        });
      });
    }
  }

  throw new Error("Stitch connection retry exhausted");
}
