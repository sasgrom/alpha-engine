export function isCohortSupportedForm(form: string): boolean {
  return /^(?:10-K|10-Q|8-K|SCHEDULE 13G|SC 13G)(?:\/A)?$/.test(form);
}
