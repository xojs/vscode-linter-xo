const xoConfig = [
	{
		prettier: true,
		rules: {
			'unicorn/prefer-module': 'off',
			'unicorn/prevent-abbreviations': 'off',
			'import-x/extensions': 'off',
			'capitalized-comments': 'off',
			'no-warning-comments': 'off'
		}
	},
	{
		files: '**/*.ts',
		rules: {
			'@typescript-eslint/consistent-type-definitions': ['error', 'interface']
		}
	},
	{
		files: 'test/**/*.ts',
		rules: {
			'@typescript-eslint/no-floating-promises': 'off'
		}
	}
];

export default xoConfig;
