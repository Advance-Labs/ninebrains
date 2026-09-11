import codingPack from './coding/pack.json';
import researchPack from './research/pack.json';
import seoPack from './seo/pack.json';
import seoCannibalization from './seo/skills/seo-cannibalization/SKILL.md?raw';
import seoContentDecay from './seo/skills/seo-content-decay/SKILL.md?raw';
import seoTrafficDrop from './seo/skills/seo-traffic-drop/SKILL.md?raw';

export interface BundledPack {
  id: string;
  /** Raw pack.json. Validated by the loader like any user pack. */
  json: unknown;
  /** Pack-relative path → file content, for the files pack.json references. */
  files: Readonly<Record<string, string>>;
}

export const bundledPacks: readonly BundledPack[] = [
  { id: 'coding', json: codingPack, files: {} },
  { id: 'research', json: researchPack, files: {} },
  {
    id: 'seo',
    json: seoPack,
    files: {
      'skills/seo-cannibalization/SKILL.md': seoCannibalization,
      'skills/seo-content-decay/SKILL.md': seoContentDecay,
      'skills/seo-traffic-drop/SKILL.md': seoTrafficDrop,
    },
  },
];
