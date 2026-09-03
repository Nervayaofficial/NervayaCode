/**
 * GST state codes and the PIN-code prefixes that map to them.
 *
 * Sources: the CBIC state-code list, and the Postal Index Number allocation.
 * Both are printed on a tax invoice and decide whether tax splits as CGST+SGST
 * or IGST, so treat edits as a finance change rather than a data tweak.
 */

/** The two-digit GST code for every live state and union territory. */
export const GST_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  // 25 (Daman & Diu) was retired when the UT merged into 26 in 2020.
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  // 28 was the pre-bifurcation Andhra Pradesh and is no longer issued; 37 is current.
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

/** Nervaya is registered in Karnataka; `29` is the prefix of its GSTIN. */
export const SELLER_STATE_CODE = '29';

/**
 * PIN prefix -> candidate GST state codes, longest prefix first.
 *
 * Several prefixes genuinely resolve to more than one state, and pretending
 * otherwise would misclassify real customers:
 *
 *  - `20`–`28` covers Uttar Pradesh AND Uttarakhand.
 *  - `80`–`85` covers Bihar AND Jharkhand.
 *  - `18`–`19` covers Jammu & Kashmir AND Ladakh.
 *  - `16` is Chandigarh, but Mohali (Punjab) also sits in 160xxx.
 *  - `682` is Ernakulam/Kochi in Kerala; only 682551–682559 are Lakshadweep, so
 *    mapping the whole prefix to Lakshadweep would relabel a major city.
 *
 * This does NOT compromise the tax split: no ambiguous set contains Karnataka,
 * so intra- vs inter-state is still decided exactly. Only the printed place-of-
 * supply NAME needs the typed state to break the tie, and the first candidate is
 * the overwhelming-majority state when it cannot.
 */
const PIN_PREFIXES: { prefix: string; states: string[] }[] = [
  // Three-digit exceptions must be tested before the ranges that contain them.
  { prefix: '396', states: ['26'] },
  { prefix: '403', states: ['30'] },
  { prefix: '605', states: ['34'] },
  { prefix: '682', states: ['32', '31'] },
  { prefix: '737', states: ['11'] },
  { prefix: '744', states: ['35'] },
  { prefix: '790', states: ['12'] },
  { prefix: '791', states: ['12'] },
  { prefix: '792', states: ['12'] },
  { prefix: '793', states: ['17'] },
  { prefix: '794', states: ['17'] },
  { prefix: '795', states: ['14'] },
  { prefix: '796', states: ['15'] },
  { prefix: '797', states: ['13'] },
  { prefix: '798', states: ['13'] },
  { prefix: '799', states: ['16'] },

  { prefix: '11', states: ['07'] },
  { prefix: '12', states: ['06'] },
  { prefix: '13', states: ['06'] },
  { prefix: '14', states: ['03'] },
  { prefix: '15', states: ['03'] },
  { prefix: '16', states: ['04', '03'] },
  { prefix: '17', states: ['02'] },
  { prefix: '18', states: ['01', '38'] },
  { prefix: '19', states: ['01', '38'] },
  { prefix: '20', states: ['09', '05'] },
  { prefix: '21', states: ['09', '05'] },
  { prefix: '22', states: ['09', '05'] },
  { prefix: '23', states: ['09', '05'] },
  { prefix: '24', states: ['09', '05'] },
  { prefix: '25', states: ['09', '05'] },
  { prefix: '26', states: ['09', '05'] },
  { prefix: '27', states: ['09', '05'] },
  { prefix: '28', states: ['09', '05'] },
  { prefix: '30', states: ['08'] },
  { prefix: '31', states: ['08'] },
  { prefix: '32', states: ['08'] },
  { prefix: '33', states: ['08'] },
  { prefix: '34', states: ['08'] },
  { prefix: '36', states: ['24'] },
  { prefix: '37', states: ['24'] },
  { prefix: '38', states: ['24'] },
  { prefix: '39', states: ['24'] },
  { prefix: '40', states: ['27'] },
  { prefix: '41', states: ['27'] },
  { prefix: '42', states: ['27'] },
  { prefix: '43', states: ['27'] },
  { prefix: '44', states: ['27'] },
  { prefix: '45', states: ['23'] },
  { prefix: '46', states: ['23'] },
  { prefix: '47', states: ['23'] },
  { prefix: '48', states: ['23'] },
  { prefix: '49', states: ['22'] },
  { prefix: '50', states: ['36'] },
  { prefix: '51', states: ['37'] },
  { prefix: '52', states: ['37'] },
  { prefix: '53', states: ['37'] },
  { prefix: '56', states: ['29'] },
  { prefix: '57', states: ['29'] },
  { prefix: '58', states: ['29'] },
  { prefix: '59', states: ['29'] },
  { prefix: '60', states: ['33'] },
  { prefix: '61', states: ['33'] },
  { prefix: '62', states: ['33'] },
  { prefix: '63', states: ['33'] },
  { prefix: '64', states: ['33'] },
  { prefix: '65', states: ['33'] },
  { prefix: '66', states: ['33'] },
  { prefix: '67', states: ['32'] },
  { prefix: '68', states: ['32'] },
  { prefix: '69', states: ['32'] },
  { prefix: '70', states: ['19'] },
  { prefix: '71', states: ['19'] },
  { prefix: '72', states: ['19'] },
  { prefix: '73', states: ['19'] },
  { prefix: '74', states: ['19'] },
  { prefix: '75', states: ['21'] },
  { prefix: '76', states: ['21'] },
  { prefix: '77', states: ['21'] },
  { prefix: '78', states: ['18'] },
  { prefix: '80', states: ['10', '20'] },
  { prefix: '81', states: ['10', '20'] },
  { prefix: '82', states: ['10', '20'] },
  { prefix: '83', states: ['10', '20'] },
  { prefix: '84', states: ['10', '20'] },
  { prefix: '85', states: ['10', '20'] },
  // 90–99 is the Army Postal Service, not a geography. Deliberately absent so it
  // falls through to the typed state rather than being labelled a state.
];

/** Spellings and abbreviations seen in a free-text state field. */
const STATE_ALIASES: Record<string, string> = {
  ka: '29',
  karnataka: '29',
  bangalore: '29',
  bengaluru: '29',
  mh: '27',
  maharashtra: '27',
  tn: '33',
  tamilnadu: '33',
  'tamil nadu': '33',
  dl: '07',
  delhi: '07',
  'new delhi': '07',
  up: '09',
  'uttar pradesh': '09',
  uk: '05',
  uttarakhand: '05',
  ap: '37',
  'andhra pradesh': '37',
  ts: '36',
  tg: '36',
  telangana: '36',
  kl: '32',
  kerala: '32',
  wb: '19',
  'west bengal': '19',
  gj: '24',
  gujarat: '24',
  rj: '08',
  rajasthan: '08',
  hr: '06',
  haryana: '06',
  pb: '03',
  punjab: '03',
  br: '10',
  bihar: '10',
  jh: '20',
  jharkhand: '20',
  od: '21',
  or: '21',
  odisha: '21',
  orissa: '21',
  mp: '23',
  'madhya pradesh': '23',
  cg: '22',
  chhattisgarh: '22',
  chattisgarh: '22',
  ga: '30',
  goa: '30',
  as: '18',
  assam: '18',
  hp: '02',
  'himachal pradesh': '02',
  jk: '01',
  'jammu and kashmir': '01',
  'jammu & kashmir': '01',
  la: '38',
  ladakh: '38',
  ch: '04',
  chandigarh: '04',
  py: '34',
  puducherry: '34',
  pondicherry: '34',
};

/** Free-text state field -> GST code, or undefined when it isn't recognisable. */
export function stateCodeFromName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (STATE_ALIASES[key]) return STATE_ALIASES[key];

  const match = Object.entries(GST_STATE_NAMES).find(([, value]) => value.toLowerCase() === key);
  return match?.[0];
}

export interface PlaceOfSupply {
  stateCode: string;
  /** `Karnataka (29)` — the form Rule 46 expects. */
  label: string;
  /** False only for Karnataka; drives CGST+SGST vs IGST. */
  interState: boolean;
  /** Which signal decided it, so a wrong invoice can be traced. */
  source: 'pin' | 'pin+state' | 'state' | 'seller-default';
}

/**
 * Decides place of supply, preferring the PIN code over the typed state.
 *
 * The PIN is the stronger signal: it is validated as six digits at checkout,
 * while `state` is a free-text input with only a required check, so it holds
 * "KA", "Karnatak" and "Bangalore" in real data.
 *
 * With no address at all — digital-only orders (Deep Rest, therapy) carry none —
 * it falls back to the seller's state. That is not a guess: with no address on
 * record for an unregistered recipient, the place of supply IS the supplier's
 * location.
 */
export function resolvePlaceOfSupply(input: { zipCode?: string | null; state?: string | null }): PlaceOfSupply {
  const digits = (input.zipCode ?? '').replace(/\D/g, '');
  const typed = stateCodeFromName(input.state);

  if (digits.length === 6) {
    const match = PIN_PREFIXES.find((entry) => digits.startsWith(entry.prefix));

    if (match) {
      // An ambiguous prefix is resolved by the typed state when it names one of
      // the candidates; otherwise the first, which is the majority state.
      const chosen = match.states.length > 1 && typed && match.states.includes(typed) ? typed : match.states[0];
      const source: PlaceOfSupply['source'] = chosen === typed && match.states.length > 1 ? 'pin+state' : 'pin';

      if (typed && !match.states.includes(typed)) {
        console.warn(
          `[place-of-supply] PIN ${digits} maps to ${match.states.join('/')} but the address says ` +
            `${typed} — using the PIN. Check the address on this order.`,
        );
      }

      return {
        stateCode: chosen,
        label: `${GST_STATE_NAMES[chosen]} (${chosen})`,
        interState: chosen !== SELLER_STATE_CODE,
        source,
      };
    }
  }

  if (typed) {
    return {
      stateCode: typed,
      label: `${GST_STATE_NAMES[typed]} (${typed})`,
      interState: typed !== SELLER_STATE_CODE,
      source: 'state',
    };
  }

  return {
    stateCode: SELLER_STATE_CODE,
    label: `${GST_STATE_NAMES[SELLER_STATE_CODE]} (${SELLER_STATE_CODE})`,
    interState: false,
    source: 'seller-default',
  };
}
