export function fmtBytes(b) {
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 100 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}
