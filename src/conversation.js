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

export function normalizeBrazilianPhoneDigits(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!digits.startsWith('55') || ![12, 13].includes(digits.length)) return null;

  // Some Brazilian WhatsApp accounts still expose the mobile PN without the
  // ninth digit. Spreadsheet imports use the current 55 + DDD + 9 digits
  // format. Mobile ranges start at 6; landlines (2-5) remain untouched.
  if (digits.length === 12 && /[6-9]/.test(digits[4])) {
    digits = `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}

export function canonicalPhoneJid(value) {
  const match = String(value || '').match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
  if (!match) return null;
  const digits = normalizeBrazilianPhoneDigits(match[1]);
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

export function phoneFromWhatsAppJid(value) {
  return canonicalPhoneJid(value)?.replace('@s.whatsapp.net', '') || null;
}

export async function resolveCustomerJid(
  key,
  phoneByLid = new Map(),
  getPhoneForLid = null
) {
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
    if (getPhoneForLid) {
      try {
        const persisted = canonicalPhoneJid(await getPhoneForLid(lidJid));
        if (persisted) {
          phoneByLid.set(lidJid, persisted);
          return persisted;
        }
      } catch {
        // A mensagem ainda pode trazer o telefone alternativo em uma próxima
        // tentativa; uma falha pontual do armazenamento não derruba o bot.
      }
    }
  }

  return null;
}
