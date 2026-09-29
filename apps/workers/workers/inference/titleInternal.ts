export function parseTitleResponseForTest(response: string): string | null {
  try {
    const parsed = JSON.parse(response) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : null;
  } catch {
    const match = response.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match) {
      try {
        return JSON.parse(`"${match[1]}"`) as string;
      } catch {
        return null;
      }
    }
    return null;
  }
}
