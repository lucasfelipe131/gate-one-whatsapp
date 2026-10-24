import { detectPlanCode } from './plans.js';

export function normalizeCommand(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

// Only clear requests open the protected customer area. Mixed financial or
// human requests continue to the existing authorized conversation flow.
export function customerPortalRequest(value, { sessionState = null } = {}) {
  const command = normalizeCommand(value);
  const choice = section => ({section});
  if (sessionState === 'menu' && ['1','2','3'].includes(command))
    return choice(({1:null,2:'guias',3:'avisos'})[command]);
  if (['GUIAS','GUIAS DE INSTALACAO','INSTALAR','COMO INSTALAR','INSTALAR NA TV'].includes(command)) return choice('guias');
  if (command === 'AVISOS') return choice('avisos');
  if (['5','NOVIDADES','CONTEUDOS','CONTEUDO','LANCAMENTOS'].includes(command)) return choice('novidades');
  if (['MEUS PAGAMENTOS','MEUSPAGAMENTOS','RENOVACAO'].includes(command) || /^(QUERO )?RENOVAR( (MEU|O) PLANO)?$/.test(command)) return choice('pagamentos');
  if (['6','8','PORTAL','AREA DO CLIENTE','MINHA AREA','CADASTRO','CADASTRO ONLINE','MEU CADASTRO','ATUALIZAR MEUS DADOS','MINHA CONTA'].includes(command) ||
      /^(AUTO ?CADASTRO|ME CADASTRAR|QUERO ME CADASTRAR|ATUALIZAR( MEUS)? DADOS|COMPLETAR( MEU)? CADASTRO|FAZER( MEU)? CADASTRO|QUERO ASSINAR|QUERO CONTRATAR|AINDA NAO SOU CLIENTE)$/.test(command)) return choice(null);
  const text = command.replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  if (text.length > 240 || isHumanSupportCommand(text) || detectPlanCode(text) ||
      /\b(NAO (QUERO|PRECISO|DESEJO)|PAGUEI|COMPROVANTE|PIX|BOLETO|CARTAO|COBRANCA|RENOVAR|RENOVACAO|PAGAR|PAGAMENTO)\b/.test(text)) return null;
  const device = /\b(TV|TELEVISAO|SAMSUNG|LG|ROKU|SMARTONE|SMART ONE|SS ?IPTV|SMARTERS|APLICATIVO|APP|URL|DNS|LISTA|M3U)\b/.test(text);
  const setup = /\b(INSTALAR|INSTALO|INSTALACAO|BAIXAR|BAIXO|CONFIGURAR|CONFIGURO|TROCAR|ALTERAR|MUDAR|ATUALIZAR)\b/.test(text);
  if (device && setup && /\b(COMO|ONDE|QUAL|QUAIS|QUERO|PRECISO|AJUDA|GUIA|PASSO A PASSO)\b/.test(text)) return choice('guias');
  if (/\b(QUAL|QUAIS|VER|CONSULTAR|RECUPERAR|ESQUECI|PERDI|MANDA|MANDE|ENVIA|ENVIE|ACESSAR|ABRIR)\b/.test(text) &&
      /\b(MEU USUARIO|MEU LOGIN|MINHA SENHA|MEUS DADOS|MEU ACESSO|AREA DO CLIENTE|MINHA AREA)\b/.test(text)) return choice(null);
  return null;
}

export function isGreetingCommand(value) {
  return /^(OI|OLA|OPA|E AI|BOM DIA|BOA TARDE|BOA NOITE|TUDO BEM|BLZ)$/.test(
    normalizeCommand(value)
  );
}

export function isExplicitMenuCommand(value) {
  return /^(MENU|INICIO|0)$/.test(normalizeCommand(value));
}

export function isPaymentOptionsCommand(value) {
  return /^(7|FORMAS DE PAGAMENTO|MEIOS DE PAGAMENTO|COMO PAGAR)$/.test(normalizeCommand(value)) ||
    /\b(ACEITA|POSSO PAGAR|DA PARA PAGAR|TEM)\b.*\b(PIX|CARTAO|BOLETO)\b/.test(normalizeCommand(value));
}

export function isHumanSupportCommand(value) {
  const text = normalizeCommand(value).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\bNAO (QUERO|PRECISO|DESEJO)\b/.test(text)) return false;
  return /^(4|ATENDENTE|SUPORTE|HUMANO)$/.test(text) ||
    /\b(FALAR|CONVERSAR) COM (UM |UMA |O |A )?(ATENDENTE|PESSOA|HUMANO|ALGUEM|EQUIPE)\b/.test(text) ||
    /\b(QUERO|PRECISO|CHAME|CHAMA) (DE )?(UM |UMA |O |A )?(ATENDENTE|HUMANO|AJUDA HUMANA)\b/.test(text);
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
