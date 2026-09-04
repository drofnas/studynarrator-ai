export function collectTiffEvidence(root?: string): Promise<{
  os: {
    id: string | undefined;
    version: string | undefined;
    codename: string | undefined;
  };
  tiffPackages: {
    name: string;
    version: string;
    source: string;
    architecture: string;
  }[];
  tiffcropPresent: boolean;
  libraryMatchesPackage: boolean;
  librarySha256: string;
}>;

export function assertScoutPolicy(options: {
  report: unknown;
  exceptions: unknown;
  sbom?: unknown;
  evidence?: unknown;
  imageId?: string;
  now?: number;
}): {
  schemaVersion: number;
  assessments: {
    id: string;
    status: string;
    justification: string;
    package: string;
    imageId: string;
    architecture: string;
    librarySha256: string;
    tiffcropPresent: boolean;
    libraryMatchesPackage: boolean;
    assessedAt: string;
    expiresAt: string;
    rationale: string;
  }[];
};
