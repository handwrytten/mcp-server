declare module "upng-js" {
  /**
   * Encode RGBA frame buffers to a PNG.
   * @param imgs  Array of RGBA pixel buffers (one per frame).
   * @param w     Image width in pixels.
   * @param h     Image height in pixels.
   * @param cnum  Color count for quantization. 0 = lossless; >0 = quantize
   *              to that many colors (produces a much smaller indexed PNG).
   */
  export function encode(
    imgs: ArrayBuffer[],
    w: number,
    h: number,
    cnum: number
  ): ArrayBuffer;

  const UPNG: { encode: typeof encode };
  export default UPNG;
}
