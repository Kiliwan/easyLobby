export type FormKind =
  | 'budget_totals'
  | 'final_totals'
  | 'budget_allowances'
  | 'final_allowances'
  | 'foreign_anonymous_allowances'

export type Side = 'yes' | 'no'
export type Stage = 'budget' | 'final'

export class ClassificationError extends Error {
  constructor(what: string, label: string) {
    super(`Unrecognised ${what} label: ${JSON.stringify(label)}`)
    this.name = 'ClassificationError'
  }
}

const FORM_LABELS: Record<string, FormKind> = {
  'Déclaration des recettes budgétées': 'budget_totals',
  'Déclaration du décompte final des recettes': 'final_totals',
  'Déclaration de libéralités supérieures à 15 000 francs': 'budget_allowances',
  'Déclaration de libéralités supérieures à 15 000 francs (décompte final)': 'final_allowances',
  'Déclaration de libéralités supérieures à 15 000 francs (y.c. étranger/anonymes)':
    'foreign_anonymous_allowances',
}

const normalise = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim()

export function classifyForm(frenchLabel: string): FormKind {
  const kind = FORM_LABELS[normalise(frenchLabel)]
  if (!kind) throw new ClassificationError('form', frenchLabel)
  return kind
}

export function classifySide(frenchCampaignLabel: string): Side {
  const label = normalise(frenchCampaignLabel)
  if (label.startsWith("Adoption de l'objet")) return 'yes'
  if (label.startsWith("Rejet de l'objet")) return 'no'
  throw new ClassificationError('campaign side', frenchCampaignLabel)
}

export function stageOf(kind: FormKind): Stage {
  switch (kind) {
    case 'budget_totals':
    case 'budget_allowances':
    case 'foreign_anonymous_allowances':
      return 'budget'
    case 'final_totals':
    case 'final_allowances':
      return 'final'
  }
}

export function payloadOf(kind: FormKind): 'totals' | 'allowances' {
  return kind === 'budget_totals' || kind === 'final_totals' ? 'totals' : 'allowances'
}
