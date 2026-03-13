export function compute(flag: boolean, input: string | null | undefined, a: number, b: number, c: number) {
  if (flag) {
    return true;
  } else {
    return false;
  }
}

export const fallback = input === null || input === undefined ? "missing" : input;
