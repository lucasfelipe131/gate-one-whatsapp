export function detectPlanCode(value) {
  const command = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  if (['MENSAL', '30', '1 MES', 'PLANO MENSAL'].includes(command)) return 'monthly';
  if (['TRIMESTRAL', '85', '3 MESES', 'PLANO TRIMESTRAL'].includes(command)) return 'quarterly';
  if (['SEMESTRAL', '150', '6 MESES', 'PLANO SEMESTRAL'].includes(command)) return 'semiannual';
  if (['ANUAL', '270', '12 MESES', 'PLANO ANUAL'].includes(command)) return 'annual';
  if (/\b(NAO|NUNCA|SEM)\b/.test(command) || /\b(COMO|QUANTO|QUAL|PRECO|VALOR|CUSTA)\b/.test(command)) return null;
  if (!/\b(RENOVAR|RENOVACAO|QUERO|ESCOLHO|PREFIRO|PODE GERAR|ENVIE|MANDA)\b/.test(command)) return null;
  const choices = [
    ['monthly', /\b(MENSAL|1 MES)\b/], ['quarterly', /\b(TRIMESTRAL|3 MESES)\b/],
    ['semiannual', /\b(SEMESTRAL|6 MESES)\b/], ['annual', /\b(ANUAL|12 MESES)\b/]
  ].filter(([, pattern]) => pattern.test(command));
  return choices.length === 1 ? choices[0][0] : null;
}
