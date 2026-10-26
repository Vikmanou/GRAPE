export interface SelectionSlice {
  /** The segment under the pointer. */
  hovered: number | undefined;
}

export function createSelectionSlice(): SelectionSlice {
  return {
    hovered: undefined,
  };
}
