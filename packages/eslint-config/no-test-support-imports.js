// Verhindert, dass Produktionscode unter src/** einen ausschließlich für
// Tests bestimmten Helfer aus test/support/** importiert (z. B. Busuu_Serializer,
// siehe design.md "Busuu_Serializer (nur Prüfmittel)" und Requirement 6.9).
// Wird von index.js als Override auf src/**/*.{ts,tsx} angewendet.
export const noTestSupportImportsRule = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/test/support/**', '**/test/support', '*/test/support/*'],
          message:
            'Code unter src/** darf keine Test-Helfer aus test/support/** importieren (siehe Requirement 6.9: Busuu_Serializer ist ausschließlich ein Prüfmittel).',
        },
      ],
    },
  ],
};
