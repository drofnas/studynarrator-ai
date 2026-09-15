export function assertTrivyPolicy(options: {
  report: unknown;
  exceptions: unknown;
  sbom?: unknown;
  audioEvidence?: unknown;
  imageId?: string;
  now?: number;
}): {
  schemaVersion: number;
  assessments: Record<string, unknown>[];
};
