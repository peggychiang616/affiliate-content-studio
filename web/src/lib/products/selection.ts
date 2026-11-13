export type SelectionResult =
  | { selectedIds: string[]; rejected: null }
  | {
      selectedIds: string[];
      rejected: "product-not-ready" | "batch-limit";
    };

export function toggleProductSelection(
  selectedIds: string[],
  productId: string,
  productReady: boolean,
): SelectionResult {
  if (!productReady) {
    return { selectedIds, rejected: "product-not-ready" };
  }

  if (selectedIds.includes(productId)) {
    return {
      selectedIds: selectedIds.filter((id) => id !== productId),
      rejected: null,
    };
  }

  if (selectedIds.length >= 3) {
    return { selectedIds, rejected: "batch-limit" };
  }

  return { selectedIds: [...selectedIds, productId], rejected: null };
}
