/** A small graph bundled with the site, credited as its licence asks (public/examples/CREDITS.md). */
export interface Example {
  id: string;
  file: string;
  title: string;
  /** What the graph shows. */
  shows: string;
  credit: string;
  licence: 'CC-BY-4.0' | 'MIT';
  source: string;
}

const ACACIA = 'Anna Syme (2020), Acacia organelle genome assembly, Zenodo';
const ACACIA_SOURCE = 'https://doi.org/10.5281/zenodo.5722622';

export const EXAMPLES: readonly Example[] = [
  {
    id: 'chloroplast',
    file: 'acacia-chloroplast-unicycler.gfa.gz',
    title: 'Acacia chloroplast',
    shows: 'Unicycler, a closed circle',
    credit: ACACIA,
    licence: 'CC-BY-4.0',
    source: ACACIA_SOURCE,
  },
  {
    id: 'mitochondrion',
    file: 'acacia-mitochondrion-spades.gfa.gz',
    title: 'Acacia mitochondrion',
    shows: 'SPAdes, repeats',
    credit: ACACIA,
    licence: 'CC-BY-4.0',
    source: ACACIA_SOURCE,
  },
  {
    id: 'lpa',
    file: 'lpa-13-haplotypes.gfa.gz',
    title: 'LPA kringle region',
    shows: '13 haplotypes, loops and tangles',
    credit: 'odgi, © 2019 Erik Garrison',
    licence: 'MIT',
    source: 'https://github.com/pangenome/odgi',
  },
  {
    id: 'human-mito',
    file: 'human-mitochondrion-minigraph.gfa.gz',
    title: 'Human mitochondrion',
    shows: 'minigraph, 8 segments',
    credit: 'minigraph, © 2019 Dana-Farber Cancer Institute',
    licence: 'MIT',
    source: 'https://github.com/lh3/minigraph',
  },
];

/** The example as a File, fetched from the site itself; no user data leaves the browser. */
export async function fetchExample(example: Example, base: string): Promise<File> {
  const response = await fetch(`${base}examples/${example.file}`);
  if (!response.ok) throw new Error(`${example.file}: HTTP ${String(response.status)}`);
  return new File([await response.blob()], example.file);
}
