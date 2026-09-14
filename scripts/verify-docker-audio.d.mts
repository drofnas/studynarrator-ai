export function collectAudioEvidence(root?: string): Promise<{
  package: string | undefined;
  version: string | undefined;
  architecture: string | undefined;
  sourceVersion: string | undefined;
  sourceSha256: string;
  configurationSha256: string;
  configuration: Record<string, number>;
  objects: string[];
  binaries: Record<string, string>;
}>;
export function assessAudioFinding(options: {
  finding: {
    id: string;
    name: string;
    installedVersion: string;
    package: string;
    fixedVersion: string;
    severity: string;
  };
  evidence: unknown;
  sbom: unknown;
  imageId: string;
  now: number;
}): Record<string, unknown> | undefined;
