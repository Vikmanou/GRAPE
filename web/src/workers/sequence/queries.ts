/** What a query may hold: IUPAC nucleotide codes (GFA1 spec, `S` records). */
const DNA = new Set('ACGTUMRWSYKVHDBN');
/** Letters amino acids use and nucleotide codes do not. */
const PROTEIN = new Set('EFILOPQXZ');

/** Beyond this a query would take over the search, and the band's cost grows with it. */
export const MAX_QUERY_BASES = 10_000_000;
export const MAX_TOTAL_BASES = 100_000_000;

export interface Query {
  name: string;
  /** Uppercase ASCII, U as T. */
  bases: Uint8Array<ArrayBuffer>;
}

export interface ParsedQueries {
  queries: Query[];
  /** Names of queries with fewer bases than a seed. */
  tooShort: string[];
}

function parsed(name: string, text: string): Query {
  const upper = text.toUpperCase();
  const bases = new Uint8Array(upper.length);
  for (let i = 0; i < upper.length; i++) {
    const letter = upper.charAt(i);
    if (!DNA.has(letter)) {
      throw new Error(
        PROTEIN.has(letter)
          ? `${name} looks like protein (it has the letter ${letter}); sequence search takes DNA only.`
          : `${name} has "${letter}", which is not a DNA base.`,
      );
    }
    bases[i] = letter === 'U' ? 84 : upper.charCodeAt(i);
  }
  if (bases.length > MAX_QUERY_BASES) {
    throw new Error(`${name} has over ${MAX_QUERY_BASES.toLocaleString('en')} bases, more than one query may hold.`);
  }
  return { name, bases };
}

/** FASTA records, or bare bases as one query. Fails on anything but DNA. */
export function parseQueries(text: string, minLength: number): ParsedQueries {
  const records: { name: string; lines: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('>')) {
      records.push({ name: line.slice(1).trim().split(/\s/, 1)[0] || `Query ${records.length + 1}`, lines: [] });
    } else if (line !== '') {
      if (records.length === 0) records.push({ name: 'Query 1', lines: [] });
      records.at(-1)?.lines.push(line.replace(/\s/g, ''));
    }
  }
  if (records.length === 0) throw new Error('There is no sequence to search for.');
  const queries: Query[] = [];
  const tooShort: string[] = [];
  let total = 0;
  for (const { name, lines } of records) {
    const query = parsed(name, lines.join(''));
    total += query.bases.length;
    if (total > MAX_TOTAL_BASES) {
      throw new Error(`The queries hold over ${MAX_TOTAL_BASES.toLocaleString('en')} bases, more than one search may.`);
    }
    if (query.bases.length < minLength) tooShort.push(name);
    else queries.push(query);
  }
  if (queries.length === 0) {
    throw new Error(`A query needs at least ${minLength} bases to hold a seed.`);
  }
  return { queries, tooShort };
}
