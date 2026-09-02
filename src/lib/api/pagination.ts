import { ServiceError } from "./errors.js";

const EXACT_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)(?![\s\S])/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/;

interface BoundedIntegerOptions {
  readonly defaultValue: number;
  readonly minimum: number;
  readonly maximum: number;
}

interface OptionalStringOptions {
  readonly maximumLength: number;
}

function invalidQuery(name: string): ServiceError {
  return new ServiceError("INVALID_INPUT", `Invalid ${name} query parameter.`, {
    parameter: name,
  });
}

function singleValue(searchParams: URLSearchParams, name: string): string | undefined {
  const values = searchParams.getAll(name);
  if (values.length > 1) {
    throw invalidQuery(name);
  }
  return values[0];
}

export function assertOnlyQueryParameters(
  searchParams: URLSearchParams,
  allowedNames: readonly string[],
): void {
  for (const name of searchParams.keys()) {
    if (!allowedNames.includes(name)) {
      throw invalidQuery(name);
    }
  }
}

export function parseBoundedInteger(
  searchParams: URLSearchParams,
  name: string,
  options: BoundedIntegerOptions,
): number {
  const value = singleValue(searchParams, name);
  if (value === undefined) {
    return options.defaultValue;
  }
  if (!EXACT_UNSIGNED_INTEGER.test(value)) {
    throw invalidQuery(name);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.minimum || parsed > options.maximum) {
    throw invalidQuery(name);
  }
  return parsed;
}

export function parseOptionalString(
  searchParams: URLSearchParams,
  name: string,
  options: OptionalStringOptions,
): string | undefined {
  const value = singleValue(searchParams, name);
  if (value === undefined || value.length === 0 || value.length > options.maximumLength) {
    if (value === undefined) {
      return undefined;
    }
    throw invalidQuery(name);
  }
  return value;
}

export function parseRequiredEnum<const Value extends string>(
  searchParams: URLSearchParams,
  name: string,
  values: readonly Value[],
): Value {
  const value = singleValue(searchParams, name);
  if (value === undefined || !values.includes(value as Value)) {
    throw invalidQuery(name);
  }
  return value as Value;
}

export function parseSlug(value: string): string {
  if (value.length > 100 || !SLUG_PATTERN.test(value)) {
    throw new ServiceError("INVALID_INPUT", "Invalid market slug.", {
      parameter: "slug",
    });
  }
  return value;
}
