// eslint.config.mjs
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
	// игноры
	{ ignores: ["dist/**", "node_modules/**"] },

	// базовые правила
	js.configs.recommended,

	// TypeScript без type-check (быстро)
	...tseslint.configs.recommended,

	// стиль: табы и длина строки
	{
		plugins: { "@stylistic": stylistic },
		rules: {
			"@stylistic/no-tabs": "off",
			"no-mixed-spaces-and-tabs": ["error", "smart-tabs"],
			"@stylistic/max-len": [
				"warn",
				{
					code: 100,
					ignoreComments: true,
					ignoreUrls: true,
					ignoreStrings: true,
					ignoreTemplateLiterals: true,
				},
			],
			"n/no-process-exit": "off",
		},
	},

	// последним — выключаем конфликты с Prettier
	eslintConfigPrettier,
];
