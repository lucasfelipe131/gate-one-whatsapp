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

function canonicalPhoneJid(value) {
  const match = String(value || '').match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
  return match ? `${match[1]}@s.whatsapp.net` : null;
}

export function resolveCustomerJid(key, phoneByLid = new Map()) {
  const candidates = [
    key?.remoteJid,
    key?.remoteJidAlt,
    key?.participant,
    key?.participantAlt
  ].filter(Boolean);
  const phoneJid = candidates.map(canonicalPhoneJid).find(Boolean) || null;
  const lidJids = candidates.filter((jid) => String(jid).endsWith('@lid'));

  if (phoneJid) {
    for (const lidJid of lidJids) phoneByLid.set(lidJid, phoneJid);
    return phoneJid;
  }

  for (const lidJid of lidJids) {
    const remembered = phoneByLid.get(lidJid);
    if (remembered) return remembered;
  }

  return null;
}
