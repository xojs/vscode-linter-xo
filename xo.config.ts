const xoConfig = [
	{
		rules: {
			'unicorn/prefer-module': 'off',
			'unicorn/prevent-abbreviations': 'off',
			'import-x/extensions': 'off',
			'capitalized-comments': 'off',
			'no-warning-comments': 'off',
			'jsdoc/require-asterisk-prefix': ['error', 'always'],
		},
	},
	{
		files: '**/*.ts',
		rules: {
			'@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
			// ensure we don't get empty module imports while using verbatim module syntax
			'@typescript-eslint/no-import-type-side-effects': 'error',
			// Enforce using .ts extensions for local imports in TS files
			// for native node.js type stripping support
			'import-x/extensions': [
				'error',
				'always',
				{
					ts: 'always',
					cts: 'always',
					mts: 'always',
					tsx: 'always',
					// Never allow relative js extensions in TS files
					js: 'never',
					jsx: 'never',
					cjs: 'never',
					mjs: 'never',
				},
			],
		},
	},
	{
		files: 'test/**/*.ts',
		rules: {
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
	{
		files: 'package.json',
		rules: {
			'package-json/no-orphan-types': 'off',
			'package-json/prefer-exports': 'off',
			'package-json/prefer-type-module': 'off',
		},
	},
];

export default xoConfig;
