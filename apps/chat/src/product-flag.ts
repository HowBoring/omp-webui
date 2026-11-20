declare global {
  // Set only by the product build entry; the Chat implementation itself never mutates it.
  var __OMP_PRODUCT__: boolean | undefined;
}

export const isProductShell = (): boolean => globalThis.__OMP_PRODUCT__ === true;
export const markProductShell = (): void => { globalThis.__OMP_PRODUCT__ = true; };
