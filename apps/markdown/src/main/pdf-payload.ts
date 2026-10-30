import { types } from 'node:util'
/** A compiled document may be saved only as bounded PDF bytes, never executable HTML. */
export function compiledPdfBytes(value: unknown): Buffer | null {
  if (!Array.isArray(value) && !types.isUint8Array(value)) return null
  if (value.length < 8 || value.length > 64 * 1024 * 1024) return null
  if (Array.isArray(value) && !value.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
    return null
  const bytes = Buffer.from(value)
  return bytes.subarray(0, 5).toString('ascii') === '%PDF-' ? bytes : null
}
