// Local reproduction of the Obsidian plugin review bot's static checks.
// Not part of the build — used to verify review findings before release.
import eslint from '@eslint/js';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		files: ['src/**/*.ts'],
		plugins: { obsidianmd },
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			...obsidianmd.ruleConfigs.recommendedTypeChecked,
			'@typescript-eslint/unbound-method': 'warn',
		},
	},
	{
		ignores: ['dist/**', 'dist-test/**', 'node_modules/**', 'test/**', 'main.js', 'eslint.review-check.config.mjs'],
	}
);
