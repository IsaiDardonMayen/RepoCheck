/**
 * Enmascara un secreto: conserva solo unos pocos caracteres iniciales y
 * reemplaza el resto por asteriscos, manteniendo la longitud.
 *
 * Regla de privacidad: como máximo se muestra un cuarto del valor (y nunca más
 * de `maxVisible` caracteres). Así, un secreto corto no queda casi completo.
 */
export function maskSecret(value: string, maxVisible = 4): string {
  const visible = Math.min(maxVisible, Math.floor(value.length / 4));
  return value.slice(0, visible) + '*'.repeat(value.length - visible);
}

/** Reemplaza cada aparición de `secret` dentro de una línea por su versión enmascarada. */
export function maskInLine(line: string, secret: string): string {
  if (secret.length === 0) return line;
  return line.split(secret).join(maskSecret(secret));
}
