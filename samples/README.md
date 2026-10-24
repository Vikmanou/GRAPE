# Sample graphs

Real, publicly available assembly and pangenome graphs for trying GRAPE and
testing it on real files. They are downloaded from their sources, not stored
in this repository.

```sh
npm run samples                 # small set, about 16 MB
npm run samples -- --large      # plus two graphs of about 100 MB each
npm run samples -- --huge       # plus 0.85 GB and 3.6 GB stress graphs
npm run samples -- --check      # parse every downloaded sample and print counts
```

`manifest.json` maps each file name to its URL (pinned to a commit or a
Zenodo record). A `#member` fragment picks a file out of a zip archive.

## Small

| File | What it shows | Source | License |
|---|---|---|---|
| `sars-cov-2-6-lineages.gfa` | SARS-CoV-2 graph of six WHO lineages (Wuhan, Alpha, Delta, BA.1, BA.5, XBB.1.5), one path per lineage | [cornell-brg/panomap](https://github.com/cornell-brg/panomap/tree/main/examples/covid) | none stated |
| `human-mito-minigraph.gfa` | Tiny human mitochondrial rGFA from minigraph, 8 segments | [lh3/minigraph](https://github.com/lh3/minigraph) | MIT |
| `human-mito-4-haplotypes.gfa` | Four human mitochondria from PGGB, PanSN path names | [pangenome/pggb](https://github.com/pangenome/pggb) | MIT |
| `brca2-cactus.gfa` | BRCA2 breast cancer gene region from Cactus, 3 paths | [vgteam/vg](https://github.com/vgteam/vg) | MIT |
| `hla-drb1-12-haplotypes.gfa` | HLA-DRB1 immune gene, 12 haplotypes, integer depth tags | [pangenome/odgi](https://github.com/pangenome/odgi) | MIT |
| `c4-complement-90-haplotypes.gfa` | Complement C4 copy-number variation, 90 paths | [pangenome/odgi](https://github.com/pangenome/odgi) | MIT |
| `lpa-13-haplotypes.gfa` | LPA kringle repeat array: loops and tangles, 13 paths | [pangenome/odgi](https://github.com/pangenome/odgi) | MIT |
| `bacterial-spades.gfa` | SPAdes bacterial graph: k-mer overlaps, KC/dp depth, 140 contig paths, 2 components | [rrwick/Unicycler](https://github.com/rrwick/Unicycler) tests | GPL-3.0 |
| `bacterial-spades.fastg` | The same graph in FASTG | [rrwick/Unicycler](https://github.com/rrwick/Unicycler) tests | GPL-3.0 |
| `mhc-57-haplotypes.gfa.gz` | Human MHC region, 57 haplotypes, gzipped | [Zenodo 23217792](https://doi.org/10.5281/zenodo.23217792) | CC-BY-4.0 |
| `human-100-genes-walks.gfa.gz` | Gene-level graph of 100 human haplotypes: 18k W walks, `*` sequences with LN | [Zenodo 23217792](https://doi.org/10.5281/zenodo.23217792) | CC-BY-4.0 |
| `chloroplast-acacia-*.gfa` | One Acacia chloroplast assembled by Flye (twice), miniasm, Raven, SPAdes and Unicycler: the same circle drawn six ways | [Zenodo 5722622](https://doi.org/10.5281/zenodo.5722622) | CC-BY-4.0 |
| `mitochondrion-acacia-*.gfa` | The Acacia mitochondrion from the same six assemblies | [Zenodo 5722622](https://doi.org/10.5281/zenodo.5722622) | CC-BY-4.0 |

## Large (`--large`)

| File | What it shows | Source | License |
|---|---|---|---|
| `myxococcus-10-assemblies.gfa.gz` | Ten *Myxococcus xanthus* assemblies: 595k short unitigs, the densest graph here | [Zenodo 23217792](https://doi.org/10.5281/zenodo.23217792) | CC-BY-4.0 |
| `potato-hifiasm-unitigs-noseq.gfa` | Potato hifiasm unitig graph without sequences: 20k segments, 910 components | [Zenodo 17599056](https://doi.org/10.5281/zenodo.17599056) | CC-BY-4.0 |

## Huge (`--huge`)

| File | What it shows | Source | License |
|---|---|---|---|
| `human-pangenome-hprc-minigraph.gfa.gz` | Human Pangenome Reference Consortium minigraph graph on GRCh38 | [HPRC](https://github.com/human-pangenomics/hpp_pangenome_resources) | open access |
| `sheep-gut-metagenome-flye.gfa` | Sheep gut metagenome assembly graph from Flye, with sequences | [Zenodo 6545142](https://doi.org/10.5281/zenodo.6545142) | CC-BY-4.0 |

## Quirks these files exercise

Real files bend the format, and GRAPE reports these as warnings:

- **miniasm** writes its own `a` and `x` records and gives a link and its mirror
  different overlaps (each measured on its own read). **hifiasm** does the
  same: the potato graph has 1,839 such pairs.
- **Raven** (the version used for the Acacia mitochondrion) links to
  odd-numbered segments such as `Utg295`, the reverse strand of `Utg294`, which
  it never defines.
- The Acacia **SPAdes** files carry a stray `i` line.
