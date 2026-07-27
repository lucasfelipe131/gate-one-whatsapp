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
  return null;
}
