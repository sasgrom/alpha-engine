export interface EventCalendarOptions {
  universeFile: string;
  suffix: string;
  from: string;
  check: boolean;
}

export function eventCalendarOptions(argv: string[]): EventCalendarOptions {
  const options: EventCalendarOptions = { universeFile: "worker/research-universe-50.json", suffix: "50", from: "2000-01-01", check: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--universe" || argument === "--suffix" || argument === "--from") {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--universe") options.universeFile = value;
      else if (argument === "--suffix") options.suffix = value;
      else options.from = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(options.suffix)) throw new Error(`Invalid output suffix: ${options.suffix}`);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(options.from)) throw new Error(`Invalid from date: ${options.from}`);
  return options;
}
