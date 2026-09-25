import sentenzaConfig from '@sentenza/eslint-config';

export default [
  {
    ignores: ['fixtures/**', '**/dist/**', 'apps/backend/schema.gql'],
  },
  ...sentenzaConfig,
];
