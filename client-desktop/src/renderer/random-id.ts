export function randomUUID(): string {
  return crypto.randomUUID().replace(/-/g, "")
}
