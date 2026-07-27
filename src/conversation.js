export function normalizeCommand(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

export function isProbableName(value) {
  const name = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 2 || name.length > 120 || !/^[\p{L}\p{M}' -]+$/u.test(name)) return false;
  return !/\b(OI|OLA|MENU|PLANO|MENSAL|TRIMESTRAL|SEMESTRAL|ANUAL|PIX|PAGAMENTO|AJUDA|SUPORTE|ATENDENTE)\b/.test(
    normalizeCommand(name)
  );
}
