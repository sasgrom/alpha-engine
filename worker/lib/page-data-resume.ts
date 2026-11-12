import { readPageDataArtifact, type PageDataArtifact, type PageDataOptions } from "./precomputed-page-data";

export function reusablePageDataArtifact<T>(options: PageDataOptions & { expectedCodeVersion: string }): PageDataArtifact<T> | null {
  const cached = readPageDataArtifact<T>(options);
  if (!cached || cached.stale || cached.codeVersion !== options.expectedCodeVersion) return null;
  return cached;
}
