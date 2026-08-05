const lineStyles = new Set(["solid", "dashed", "dotted", "double"])

export function normalizeHorizontalRuleAttributes(attributes: Record<string, unknown>) {
  const thickness = Number(attributes.thickness)
  return {
    lineStyle:
      typeof attributes.lineStyle === "string" && lineStyles.has(attributes.lineStyle)
        ? attributes.lineStyle
        : "solid",
    thickness: Number.isInteger(thickness) && thickness >= 1 && thickness <= 6 ? thickness : 1,
  }
}
