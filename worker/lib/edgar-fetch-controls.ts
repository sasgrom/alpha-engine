export function edgarFetchLimit(value: string | null): number | null {
  if (value === null) return null;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("--limit must be a positive integer");
  return limit;
}

export function edgarFetchForms(value: string | null): Set<string> | null {
  if (value === null) return null;
  const forms = value.split(",").map(form => form.trim().toUpperCase());
  if (!forms.length || forms.some(form => !["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A"].includes(form))) {
    throw new Error("--forms accepts 10-K, 10-Q and 8-K");
  }
  return new Set(forms.flatMap(form => form.endsWith("/A") ? [form] : [form, `${form}/A`]));
}
