// These rules are learned, not a claim that every default in the example was reviewed.
export const LEARNED_RULE_SOURCE = {
  example: '20261007-120449-97686de3.json',
  sha256: 'a87e42b1b51240d9aa1d24ffa6d8be04d0e9ab25fd302e6c8083f25022807ae2',
  additionalExamples: [{ example: '20261007-170726-cc7da5ba.json',
    sha256: '2b9c8b4350fb341cc369e6a2162c7351e3f8ece327ae60fd0029e22fda9dd04f' }],
  evidence: 'Author descriptions, consistent example placements, and inspected artwork. Macro halls remain pending.'
};

const straight = {
  movement: false, lightShape: 'edges',
  movementFeatures: ['p:0:0', 'p:1:0', 'p:0:1', 'p:1:1', 'v:0:0', 'v:1:0'],
  lightFeatures: ['v:0:0', 'v:1:0']
};
const corner = {
  movement: false, lightShape: 'edges',
  movementFeatures: ['p:1:0', 'p:0:1', 'p:1:1', 'v:1:0', 'h:0:1'],
  lightFeatures: ['v:1:0', 'h:0:1']
};

export const LEARNED_TILE_RULES = {
  'org-free-NWoNEoSEoSWoNxEoSxWo.png': {
    ...straight, digest: '0006196389acc746c00b2e56965cdb99a0ff94ac542a9e163087f1ac1c761ff2'
  },
  'org-free-NWoNEoSEoSWoNxEoSxWo1.png': {
    ...straight, digest: '812d1fb2cbc73f982ffc064ef3e057df3610032fc3c46d988acbb05252f9d74c'
  },
  'org-free-NWoNEoSEoSWoNxEoSxWo2.png': {
    ...straight, digest: 'cd840264ef8ea9cca7abb1f4ef18f240a65d8935be3ba72497c30cbb7c057ab1'
  },
  'org-free-NWoNEoSEoSWoNxEoSoWx1.png': {
    ...corner, movementFeatures: [...corner.movementFeatures, 'p:0:0'],
    digest: '6aebe36f31762b8866880868898606ecdbb016141c0427e320f0bcc00250ab8a'
  },
  'org-free-NWxNEoSEoSWoNxEoSoWx.png': {
    ...corner, digest: '25673e3aa5b8c8ada9304e0c9151ca80453d0658fc80e2764f4bdcb93d444f89'
  },
  'org-free-NWxNEoSEoSWoNxEoSoWx1.png': {
    ...corner, digest: '2b4edc184ac5c91bbf8f5036e6a099ff1f38b175a1612f91852c7135ce8a4475'
  },
  'org-free-NWxNEoSEoSWxNxEoSxWx.png': {
    movement: false, lightShape: 'edges', movementFeatures: ['p:1:0', 'p:1:1', 'v:1:0'],
    lightFeatures: ['v:1:0'], digest: '05d0b8f98b33c25bf9dd2de361fc744699197724e1e45dd91b428ce31c550d40'
  },
  'org-blocks-NWxNExSExSWxNxExSxWx.png': {
    movement: true, lightShape: 'pillar', movementFeatures: [], lightFeatures: [],
    digest: '15f64c688d07c1e9ed7ae536cd205bc51f39fb4cb975851d8faf0472a49bc6d9'
  },
  'org-free-NWoNEoSExSWoNxExSxWo1.png': {
    movement: false, lightShape: 'edges', movementFeatures: ['p:0:0', 'p:1:0', 'p:0:1', 'v:0:0'],
    lightFeatures: ['v:0:0'], digest: '73a4e7864603b4abd4b5c4068e5657c55db6d8270f43b975c1ca98b680837642'
  },
  'org-free-NWoNExSEoSWoNxEoSoWx1.png': {
    ...corner, movementFeatures: ['p:0:0', 'p:0:1', 'p:1:1', 'v:1:0', 'h:0:1'],
    digest: '0768a3abd6bdfc1efd3db7839cfcd310b546c0e6f8e49c4f9c606e450894be76'
  },
  'org-free-NWoNExSEoSWoNxEoSoWx2.png': {
    ...corner, movementFeatures: ['p:0:0', 'p:0:1', 'p:1:1', 'v:1:0', 'h:0:1'],
    digest: '6c14757eda9d882a860c96ea36195ffbbfd11b7542fde63594569be239dd287d'
  },
  'org-free-NWxNEoSEoSWoNxEoSxWo.png': {
    ...straight, movementFeatures: ['p:1:0', 'p:0:1', 'p:1:1', 'v:0:0', 'v:1:0'],
    digest: 'e1d80b52ab862ffe281407968d470f92eeb178cb1cbf6ea1068f21f4673a8e49'
  },
  'org-free-NWxNExSEoSWxNxExSoWx.png': {
    movement: false, lightShape: 'edges', movementFeatures: ['p:1:1', 'h:0:1'],
    lightFeatures: ['h:0:1'], digest: '010853a9e85f2f566bec32ba27b598dcf30bc1936da7050442138da36b3f3dfe'
  },
  'org-free-NWxNExSExSWxNxExSoWo.png': {
    movement: false, lightShape: 'edges', movementFeatures: ['v:0:0', 'h:0:1'],
    lightFeatures: ['v:0:0', 'h:0:1'], digest: 'a4f0d34ef1aa01ee378de38587744e73aa0bceadb248eca072df8c88f6ac366f'
  }
};

// Partial evidence never confirms a whole asset or supplies rules for unedited features.
export { LEARNED_FEATURE_RULES } from './learned-feature-rules.mjs';
