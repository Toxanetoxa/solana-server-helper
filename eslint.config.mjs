// eslint.config.mjs
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
import n from "eslint-plugin-n";
import importX from "eslint-plugin-import-x";

export default [
	{ ignores: ["dist/**", "node_modules/**"] },

	js.configs.recommended,
	...tseslint.configs.recommended,

	{
		plugins: { "@stylistic": stylistic, n, "import-x": importX },
		rules: {
			"@stylistic/no-tabs": "off",
			"no-mixed-spaces-and-tabs": ["error", "smart-tabs"],
			"@stylistic/max-len": [
				"warn",
				{
					// или 'off', если не нужно
					code: 100,
					ignoreComments: true,
					ignoreUrls: true,
					ignoreStrings: true,
					ignoreTemplateLiterals: true,
				},
			],
			"n/file-extension-in-import": [
				"error",
				"always",
				{
					ignorePackages: true,
					tryExtensions: [".js", ".mjs", ".cjs", ".ts", ".tsx"],
				},
			],
			"import-x/extensions": "off",
		},
		settings: {
			"import-x/resolver": {
				typescript: { project: true, alwaysTryTypes: true },
				node: { extensions: [".js", ".mjs", ".cjs", ".ts", ".tsx"] },
			},
		},
	},

	eslintConfigPrettier,
];
