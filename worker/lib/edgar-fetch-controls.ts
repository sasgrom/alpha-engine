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
  if (!forms.length || forms.some(form => !["10-K", "10-Q"].includes(form))) {
    throw new Error("--forms currently accepts only 10-K and 10-Q");
  }
  return new Set(forms.flatMap(form => [form, `${form}/A`]));
}
